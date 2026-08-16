-- ═══════════════════════════════════════════════════════════════
--  조기 확정 — 2:2 로 열었지만 1:1 로 하기
-- ═══════════════════════════════════════════════════════════════
-- 2:2 로 열어놨는데 남 1 · 여 1 에서 더 안 모이는 일이 흔하다. 지금은
-- 정원이 꽉 차야만 확정되니, 두 사람이 이미 있어도 모임이 성사되지 않는다.
--
-- 성비가 맞아 있으면(남 = 여) 호스트가 "이대로 확정하자" 고 제안하고,
-- 게스트가 받으면 그 인원으로 모임이 완성된다. 채팅방도 그때 열린다.
--
-- 호스트 혼자 정하지 않는 이유 — 게스트는 2:2 인 줄 알고 신청했다.
-- 1:1 은 다른 자리라서, 받을지 말지는 게스트가 정해야 한다.
--
-- 확정되는 순간 capacity 를 실제 모인 수로 줄인다. 그러면 자리 표시도
-- 채팅방도 진행 화면도 전부 기존 규칙 그대로 맞아떨어진다.

alter table sessions add column if not exists early_confirm_at timestamptz;

-- 누가 받았는지. 지금은 게스트가 한 명뿐이지만 표로 두면 나중에
-- 3:3 을 2:2 로 줄이는 경우에도 그대로 쓸 수 있다.
create table if not exists session_confirm_acks (
  session_id uuid not null references sessions(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (session_id, user_id)
);

alter table session_confirm_acks enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.

-- ───────────────────────────────────────────────────────────────
--  1. 호스트가 제안한다
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
  -- 이미 꽉 찼으면 제안할 것 없이 자동으로 확정된다
  if m >= s.capacity then return json_build_object('error','already_full'); end if;

  -- 다시 제안하면 이전 답은 무효로 한다
  delete from session_confirm_acks where session_id = p_session;
  update sessions set early_confirm_at = now() where id = p_session;

  return json_build_object('ok', true, 'matched', m);
end $$;

-- 호스트가 거두거나, 게스트가 "다음에요" 를 누르면 없던 일로
create or replace function session_withdraw_confirm(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.status <> 'open' then return json_build_object('error','not_open'); end if;
  if s.host_id <> auth.uid()
     and not exists (select 1 from signups
                      where session_id = p_session and user_id = auth.uid()
                        and status = 'confirmed')
  then return json_build_object('error','not_member'); end if;

  delete from session_confirm_acks where session_id = p_session;
  update sessions set early_confirm_at = null where id = p_session;
  return json_build_object('ok', true);
end $$;

-- ───────────────────────────────────────────────────────────────
--  2. 게스트가 받는다 → 모임 완성
-- ───────────────────────────────────────────────────────────────

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

  -- 제안한 뒤에 누가 빠졌을 수 있다. 성비가 깨졌으면 확정하지 않는다.
  select count(*) into m from signups
   where session_id = p_session and gender = 'm' and status = 'confirmed';
  select count(*) into f from signups
   where session_id = p_session and gender = 'f' and status = 'confirmed';
  if m <> f or m < 1 then return json_build_object('error','not_balanced'); end if;

  insert into session_confirm_acks (session_id, user_id)
  values (p_session, auth.uid())
  on conflict do nothing;

  -- 아직 답하지 않은 게스트 (호스트는 제안한 쪽이라 뺀다)
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

  -- 실제 모인 수로 정원을 줄인다. 이 한 줄로 자리 표시·채팅방·진행 화면이
  -- 전부 "꽉 찬 모임" 으로 맞아떨어진다.
  update sessions set capacity = m, status = 'confirmed' where id = p_session;

  return json_build_object('ok', true, 'confirmed', true, 'capacity', m);
end $$;

-- ───────────────────────────────────────────────────────────────
--  3. 목록에 제안 상태를 실어 보낸다
-- ───────────────────────────────────────────────────────────────
-- 화면이 버튼을 그리려면 "내가 호스트인지 · 제안이 떠 있는지 · 내가
-- 이미 받았는지" 를 알아야 한다.

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
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 권한
-- ───────────────────────────────────────────────────────────────

revoke execute on function session_propose_confirm(uuid)  from public, anon;
revoke execute on function session_withdraw_confirm(uuid) from public, anon;
revoke execute on function session_accept_confirm(uuid)   from public, anon;
revoke execute on function session_list()                 from public, anon;

grant execute on function
  session_propose_confirm(uuid), session_withdraw_confirm(uuid),
  session_accept_confirm(uuid), session_list()
to authenticated;
