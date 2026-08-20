-- ═══════════════════════════════════════════════════════════════
--  푸시 수신자 목록 + 호스트의 자기 모임 접근
-- ═══════════════════════════════════════════════════════════════
-- 알림은 클라이언트가 Edge Function(push)에 부탁하는 구조라, 서버 RPC 가
-- "누구에게 보내야 하는지"(notify 배열)를 돌려줘야 한다. 빠져 있던 곳:
--
--   · 모임 단체방 새 메시지 — 시간·장소를 맞추는 방인데 알림이 없었다
--   · 조기확정 제안 도착 — 게스트가 신청함을 열어야만 알았다
--   · 모임이 확정되는 순간 — 마지막 한 명에게만 알림이 갔다
--
-- 덤으로 session_list 의 차단 필터가 호스트 자신에게도 걸려서, 확정
-- 참가자를 신고(=차단)한 호스트가 자기 모임 상세를 못 열어 삭제·환불을
-- 못 하는 문제를 고친다 — 내 모임은 항상 보인다.

-- ───────────────────────────────────────────────────────────────
--  1. 단체방 메시지 — 20260816160000 의 정의 + notify
-- ───────────────────────────────────────────────────────────────
create or replace function session_chat_send(p_session uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_body,''))) = 0 then
    return json_build_object('error','empty');
  end if;
  if not session_chat_member(p_session) then
    return json_build_object('error','not_allowed');
  end if;

  insert into messages (session_id, sender_id, body)
  values (p_session, auth.uid(), trim(p_body));

  -- 나 빼고 확정자 전원 — 클라이언트가 이 목록으로 push 를 부탁한다
  return json_build_object('ok', true,
    'notify', (select coalesce(json_agg(g.user_id), '[]'::json)
                 from signups g
                where g.session_id = p_session
                  and g.status = 'confirmed'
                  and g.user_id <> auth.uid()));
end $$;

-- ───────────────────────────────────────────────────────────────
--  2. 조기확정 — 20260816183000 의 정의 + notify
-- ───────────────────────────────────────────────────────────────
create or replace function session_propose_confirm(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; m int; f int;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id <> auth.uid() then return json_build_object('error','not_host'); end if;
  if s.status <> 'open' then return json_build_object('error','not_open'); end if;

  select count(*) into m from signups
   where session_id = p_session and gender = 'm' and status = 'confirmed';
  select count(*) into f from signups
   where session_id = p_session and gender = 'f' and status = 'confirmed';

  if m <> f or m < 1 then return json_build_object('error','not_balanced'); end if;
  if m >= s.capacity then return json_build_object('error','already_full'); end if;

  delete from session_confirm_acks where session_id = p_session;
  update sessions set early_confirm_at = now() where id = p_session;

  -- 답해야 하는 게스트들 (호스트 제외)
  return json_build_object('ok', true, 'matched', m,
    'notify', (select coalesce(json_agg(g.user_id), '[]'::json)
                 from signups g
                where g.session_id = p_session
                  and g.status = 'confirmed'
                  and g.user_id <> s.host_id));
end $$;

create or replace function session_accept_confirm(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; m int; f int; pending int;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.status <> 'open' then return json_build_object('error','not_open'); end if;
  if s.early_confirm_at is null then return json_build_object('error','no_proposal'); end if;
  if s.host_id = auth.uid() then return json_build_object('error','is_host'); end if;

  if not exists (select 1 from signups
                  where session_id = p_session and user_id = auth.uid()
                    and status = 'confirmed')
  then return json_build_object('error','not_member'); end if;

  select count(*) into m from signups
   where session_id = p_session and gender = 'm' and status = 'confirmed';
  select count(*) into f from signups
   where session_id = p_session and gender = 'f' and status = 'confirmed';
  if m <> f or m < 1 then return json_build_object('error','not_balanced'); end if;

  insert into session_confirm_acks (session_id, user_id)
  values (p_session, auth.uid())
  on conflict do nothing;

  select count(*) into pending
    from signups g
   where g.session_id = p_session
     and g.status = 'confirmed'
     and g.user_id <> s.host_id
     and not exists (select 1 from session_confirm_acks a
                      where a.session_id = p_session and a.user_id = g.user_id);

  if pending > 0 then
    return json_build_object('ok', true, 'confirmed', false, 'waiting', pending);
  end if;

  update sessions set capacity = m, status = 'confirmed' where id = p_session;

  -- 확정의 순간 — 나 빼고 전원(호스트 포함)에게 알린다
  return json_build_object('ok', true, 'confirmed', true, 'capacity', m,
    'notify', (select coalesce(json_agg(g.user_id), '[]'::json)
                 from signups g
                where g.session_id = p_session
                  and g.status = 'confirmed'
                  and g.user_id <> auth.uid()));
end $$;

-- ───────────────────────────────────────────────────────────────
--  3. 호스트 승인 — 20260816233000 의 정의(차단 검사 포함) + notify
-- ───────────────────────────────────────────────────────────────
-- 승인으로 정원이 차서 방이 열리면, "방금 승인된 사람" 말고도 이미
-- 확정돼 있던 사람들이 있다 — 그들도 방이 열린 걸 알아야 한다.
-- (승인된 사람 본인은 클라이언트가 따로 "수락됐어요" 를 보낸다)
create or replace function session_approve(p_session uuid, p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; g signups; confirmed_cnt int; opened boolean;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id <> auth.uid() then return json_build_object('error','not_host'); end if;
  if blocked_with(p_user) then return json_build_object('error','blocked'); end if;

  select * into g from signups
   where session_id = p_session and user_id = p_user;
  if not found or g.status <> 'waiting' then
    return json_build_object('error','not_waiting');
  end if;

  select count(*) into confirmed_cnt from signups
   where session_id = p_session and gender = g.gender and status = 'confirmed';
  if confirmed_cnt >= s.capacity then
    return json_build_object('error','full');
  end if;

  update signups set status = 'confirmed'
   where session_id = p_session and user_id = p_user;

  opened := session_try_confirm(p_session);

  return json_build_object('ok', true, 'chat_opened', opened,
    'notify', case when opened then
      (select coalesce(json_agg(x.user_id), '[]'::json)
         from signups x
        where x.session_id = p_session
          and x.status = 'confirmed'
          and x.user_id not in (s.host_id, p_user))
    else '[]'::json end);
end $$;

-- ───────────────────────────────────────────────────────────────
--  4. 모임 목록 — 내가 호스트인 모임은 차단과 무관하게 보인다
-- ───────────────────────────────────────────────────────────────
-- 20260816233000 의 정의를 대체한다. 차단 필터·조기확정 필드 전부 유지.
-- ⚠️ 이후 고칠 때 차단 조건과 호스트 예외를 함께 들고 갈 것.
create or replace function session_list()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity,
           s.level_min, s.level_max, s.age_min, s.age_max,
           s.intensity, s.after_meal, s.note, s.status,
           s.host_id,
           h.nickname as host_nickname,
           h.photo    as host_photo,
           h.age      as host_age,
           h.area     as host_area,
           h.level    as host_level,
           (s.host_id = auth.uid()) as i_am_host,
           s.early_confirm_at,
           exists (select 1 from session_confirm_acks a
                    where a.session_id = s.id and a.user_id = auth.uid()) as my_ack,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select g.status from signups g
             where g.session_id = s.id and g.user_id = auth.uid()) as my_status
      from sessions s
      left join profiles h on h.id = s.host_id
     where s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
       -- 내 모임은 항상 — 안 보이면 삭제·관리(환불)를 못 한다.
       -- 남의 모임은 차단 관계가 있으면 감춘다.
       and (s.host_id = auth.uid()
         or ((s.host_id is null or not blocked_with(s.host_id))
             and not exists (
               select 1 from signups g
                where g.session_id = s.id and g.status = 'confirmed'
                  and blocked_with(g.user_id))))
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  5. 권한 (기존과 동일 — create or replace 가 유지하지만 명시)
-- ───────────────────────────────────────────────────────────────
revoke execute on function session_chat_send(uuid,text)      from public, anon;
revoke execute on function session_propose_confirm(uuid)     from public, anon;
revoke execute on function session_accept_confirm(uuid)      from public, anon;
revoke execute on function session_approve(uuid,uuid)        from public, anon;
revoke execute on function session_list()                    from public, anon;

grant execute on function
  session_chat_send(uuid,text), session_propose_confirm(uuid),
  session_accept_confirm(uuid), session_approve(uuid,uuid), session_list()
to authenticated;
