-- ═══════════════════════════════════════════════════════════════
--  신고 · 차단
--
--  사진·영상·채팅이 오가는 앱은 애플 심사 1.2 에서 네 가지를 요구한다.
--   ① 신고 수단  ② 차단 수단  ③ 24시간 내 조치  ④ 약관 동의
--  여기서 ①②를 만들고, ③은 reports 테이블을 운영자가 보는 것으로 받는다.
--
--  차단은 "만들어만 두고 아무 데도 안 쓰면" 의미가 없다. 실제로 막아야 할
--  길이 여섯 군데라 기존 함수를 전부 다시 정의한다 —
--  사람 찾기 · 채팅 목록 · 채팅 읽기 · 채팅 쓰기 · 관심 · 모임 참여.
--
--  몇 번 돌려도 안전하다.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  1. 차단
-- ───────────────────────────────────────────────────────────────
create table if not exists blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on blocks (blocked_id);

alter table blocks enable row level security;
-- 내가 건 차단만 읽는다. "누가 나를 차단했는지" 는 보이면 안 된다.
drop policy if exists "blocks: mine readable" on blocks;
create policy "blocks: mine readable" on blocks
  for select to authenticated using (auth.uid() = blocker_id);

-- 차단은 한쪽만 걸어도 양방향으로 막힌다. 차단당한 쪽이 우회로로
-- 계속 접근할 수 있으면 차단이 아니다.
--
-- security definer 인 이유: RLS 정책 안에서 쓰이는데, 정책은 호출자
-- 권한으로 평가된다. 그대로 두면 blocks 의 RLS 가 다시 걸려서
-- "상대가 나를 차단한 행" 이 안 보이고 판정이 뚫린다.
create or replace function blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
     where (blocker_id = auth.uid() and blocked_id = p_other)
        or (blocker_id = p_other  and blocked_id = auth.uid()))
$$;

create or replace function block_user(p_target uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('error','no_auth'); end if;
  if p_target = auth.uid() then return json_build_object('error','self'); end if;
  if not exists (select 1 from profiles where id = p_target) then
    return json_build_object('error','not_found');
  end if;

  insert into blocks (blocker_id, blocked_id) values (auth.uid(), p_target)
  on conflict do nothing;

  return json_build_object('ok', true);
end; $$;

create or replace function unblock_user(p_target uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('error','no_auth'); end if;
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_target;
  return json_build_object('ok', true);
end; $$;

-- 차단 목록 — 상대 프로필은 RLS 로 막혀 있어 직접 조회가 안 되므로 여기서 준다
create or replace function my_blocks()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select b.blocked_id, b.created_at, p.nickname, p.age, p.home_gym
      from blocks b join profiles p on p.id = b.blocked_id
     where b.blocker_id = auth.uid()
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  2. 신고
-- ───────────────────────────────────────────────────────────────
-- 신고자·대상이 탈퇴해도 신고 기록은 남긴다 (set null). 기록이 계정과
-- 함께 사라지면 "탈퇴로 신고를 지우는" 길이 열리고, 운영자가 조치했다는
-- 증빙도 남지 않는다. 개인정보는 들고 있지 않고 id 만 끊는다.
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete set null,
  target_id   uuid references profiles(id) on delete set null,
  reason      text not null check (reason in
              ('abuse','sexual','fake','commercial','noshow','other')),
  detail      text,
  context     text not null default 'profile'
              check (context in ('profile','chat','session')),
  ref_id      uuid,                       -- 채팅방·모임 id (있으면)
  status      text not null default 'open'
              check (status in ('open','actioned','dismissed')),
  created_at  timestamptz default now()
);

create index if not exists reports_open_idx on reports (status, created_at);

-- 같은 사람을 상대로 처리 안 된 신고가 여러 건 쌓이지 않게
create unique index if not exists reports_open_once
  on reports (reporter_id, target_id) where status = 'open';

alter table reports enable row level security;
-- 정책 없음 = 직접 접근 차단. 신고 내용은 본인도 다시 못 본다
-- (재신고 유도·보복 방지). 운영자는 대시보드로 본다.

-- 신고하면 자동으로 차단까지 간다. 신고해놓고 계속 노출되면
-- 신고한 의미가 없고, 두 번 누르게 하는 것도 번거롭다.
create or replace function report_user(
  p_target  uuid,
  p_reason  text,
  p_detail  text default null,
  p_context text default 'profile',
  p_ref     uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid();
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;
  if p_target = me_id then return json_build_object('error','self'); end if;
  if not exists (select 1 from profiles where id = p_target) then
    return json_build_object('error','not_found');
  end if;

  insert into reports (reporter_id, target_id, reason, detail, context, ref_id)
  values (me_id, p_target, p_reason, nullif(trim(p_detail), ''),
          coalesce(p_context, 'profile'), p_ref)
  on conflict do nothing;   -- 이미 처리 대기 중인 신고가 있으면 그대로 둔다

  insert into blocks (blocker_id, blocked_id) values (me_id, p_target)
  on conflict do nothing;

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. 막아야 할 길 ① 사람 찾기
-- ───────────────────────────────────────────────────────────────
-- 사람 찾기는 RPC 가 아니라 profiles 를 직접 조회한다. 그래서 정책에서 막는다.
-- (RPC 들은 security definer 라 RLS 를 지나가므로 아래에서 따로 막는다)
drop policy if exists "profiles: public readable" on profiles;
create policy "profiles: public readable" on profiles
  for select to authenticated
  using (auth.uid() = id or (is_public = true and not blocked_with(id)));

-- ───────────────────────────────────────────────────────────────
--  4. 막아야 할 길 ② 채팅 목록
-- ───────────────────────────────────────────────────────────────
create or replace function my_chats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json) from (
    select m.id as match_id,
           m.session_id,
           s.gym,                      -- 관심 수락으로 생긴 방이면 NULL
           p.id   as partner_id,
           p.nickname,
           p.age,
           p.level,
           p.home_gym,
           p.photo,
           (select body from messages x
             where x.match_id = m.id order by x.created_at desc limit 1) as last_body,
           coalesce(
             (select max(created_at) from messages x where x.match_id = m.id),
             m.created_at) as last_at,
           (select count(*) from messages x
             where x.match_id = m.id
               and x.sender_id <> auth.uid()
               and x.created_at > coalesce(
                     (select r.last_read_at from chat_reads r
                       where r.match_id = m.id and r.user_id = auth.uid()),
                     '-infinity'::timestamptz)) as unread
      from matches m
      left join sessions s on s.id = m.session_id
      join profiles p
        on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
     where auth.uid() in (m.user_a, m.user_b)
       and not blocked_with(p.id)
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  5. 막아야 할 길 ③④ 채팅 읽기 · 쓰기
-- ───────────────────────────────────────────────────────────────
-- 목록에서 감추는 것만으로는 부족하다. 방 id 를 이미 들고 있으면
-- 그대로 들어가진다.
create or replace function chat_messages(p_match uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare other uuid;
begin
  select case when user_a = auth.uid() then user_b else user_a end into other
    from matches where id = p_match and auth.uid() in (user_a, user_b);
  if other is null then return json_build_object('error','not_allowed'); end if;
  if blocked_with(other) then return json_build_object('error','blocked'); end if;

  return (
    select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json) from (
      select id, sender_id, body, created_at,
             (sender_id = auth.uid()) as mine
        from messages where match_id = p_match
    ) t
  );
end; $$;

create or replace function chat_send(p_match uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  if length(trim(coalesce(p_body,''))) = 0 then
    return json_build_object('error','empty');
  end if;

  select case when user_a = auth.uid() then user_b else user_a end into other
    from matches where id = p_match and auth.uid() in (user_a, user_b);
  if other is null then return json_build_object('error','not_allowed'); end if;
  if blocked_with(other) then return json_build_object('error','blocked'); end if;

  insert into messages (match_id, sender_id, body)
  values (p_match, auth.uid(), trim(p_body));

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  6. 막아야 할 길 ⑤ 관심
-- ───────────────────────────────────────────────────────────────
-- 차단 검사는 크레딧을 빼기 "전" 이어야 한다. 순서가 뒤바뀌면
-- 보내지도 못한 관심에 크레딧만 나간다.
create or replace function request_send(p_to uuid, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; you profiles; sent_today int; existing requests;
        cost int := -credit_rule('request_extra'); bal int; spent boolean := false;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;
  if p_to = me.id then return json_build_object('error','self'); end if;

  select * into you from profiles where id = p_to;
  if not found then return json_build_object('error','not_found'); end if;
  if blocked_with(p_to) then return json_build_object('error','blocked'); end if;
  if not you.is_public then return json_build_object('error','not_public'); end if;
  if you.gender = me.gender then return json_build_object('error','same_gender'); end if;

  select * into existing from requests where from_id = me.id and to_id = p_to;
  if found then
    return json_build_object('error','already', 'status', existing.status);
  end if;

  -- 같은 유저의 동시 요청이 한도를 함께 넘기지 못하게 잠근다
  perform pg_advisory_xact_lock(hashtext(me.id::text));

  select count(*) into sent_today from requests
   where from_id = me.id and created_at > now() - interval '1 day';

  -- 무료 제공분(기본 0)을 넘으면 크레딧으로 차감한다
  if sent_today >= request_daily_limit() then
    bal := credit_balance(me.id);
    if bal < cost then
      return json_build_object('error','no_credits', 'cost', cost, 'balance', bal);
    end if;
    -- ref 를 매번 다르게 둬야 여러 번 차감된다
    insert into credit_ledger (user_id, delta, reason, ref)
    values (me.id, -cost, 'request_extra',
            p_to::text || ':' || extract(epoch from now())::bigint::text);
    spent := true;
  end if;

  insert into requests (from_id, to_id, message)
  values (me.id, p_to, nullif(trim(p_message), ''));

  return json_build_object('ok', true,
    'free_left', greatest(0, request_daily_limit() - sent_today - 1),
    'spent', spent, 'cost', case when spent then cost else 0 end,
    'balance', credit_balance(me.id));
end; $$;

-- 신청함 — 차단 전에 받은 관심도 안 보이게
create or replace function requests_received()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.message, r.status, r.created_at,
           p.id as from_id, p.nickname, p.age, p.level, p.career,
           p.height, p.home_gym, p.area, p.mbti, p.intro, p.photo
      from requests r join profiles p on p.id = r.from_id
     where r.to_id = auth.uid() and r.status = 'pending'
       and not blocked_with(p.id)
  ) t;
$$;

create or replace function requests_sent()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.created_at,
           case when r.status = 'accepted' then 'accepted' else 'pending' end as status,
           p.id as to_id, p.nickname, p.age, p.level, p.home_gym
      from requests r join profiles p on p.id = r.to_id
     where r.from_id = auth.uid()
       and not blocked_with(p.id)
  ) t;
$$;

-- 배지 숫자도 같이 빼야 한다. 안 그러면 "1" 이 떠 있는데
-- 들어가면 아무것도 없는 상태가 된다.
create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests r
                  where r.to_id = auth.uid() and r.status = 'pending'
                    and not blocked_with(r.from_id)),
    'sent_today', (select count(*) from requests
                    where from_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', request_daily_limit(),
    'unread_messages', (
      select count(*)
        from messages x
        join matches m on m.id = x.match_id
       where auth.uid() in (m.user_a, m.user_b)
         and x.sender_id <> auth.uid()
         and not blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
         and x.created_at > coalesce(
               (select r.last_read_at from chat_reads r
                 where r.match_id = m.id and r.user_id = auth.uid()),
               '-infinity'::timestamptz)),
    'unread_rooms', (
      select count(*) from matches m
       where auth.uid() in (m.user_a, m.user_b)
         and not blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
         and exists (
           select 1 from messages x
            where x.match_id = m.id
              and x.sender_id <> auth.uid()
              and x.created_at > coalesce(
                    (select r.last_read_at from chat_reads r
                      where r.match_id = m.id and r.user_id = auth.uid()),
                    '-infinity'::timestamptz)))
  );
$$;

-- ───────────────────────────────────────────────────────────────
--  7. 막아야 할 길 ⑥ 모임
-- ───────────────────────────────────────────────────────────────
-- 차단한 사람이 확정돼 있는 모임은 목록에서 감춘다.
-- "참여 불가" 라고만 띄우면 그 사람이 어느 짐 어느 시간에 있는지가
-- 역으로 드러난다.
create or replace function session_list()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity,
           s.level_min, s.level_max, s.age_min, s.age_max,
           s.intensity, s.after_meal, s.note, s.status,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select g.status from signups g
             where g.session_id = s.id and g.user_id = auth.uid()) as my_status
      from sessions s
     where s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
       and not exists (
         select 1 from signups g
          where g.session_id = s.id and g.status = 'confirmed'
            and blocked_with(g.user_id))
  ) t;
$$;

-- 목록에서 감춰도 id 를 들고 있으면 신청은 된다. 여기서도 막는다.
create or replace function session_join(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; s sessions; confirmed_cnt int; new_status text;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session for update;
  if not found or s.status not in ('open','confirmed') then
    return json_build_object('error','not_open');
  end if;
  if s.host_id = me.id then return json_build_object('error','is_host'); end if;

  if exists (select 1 from signups g
              where g.session_id = s.id and g.status = 'confirmed'
                and blocked_with(g.user_id)) then
    return json_build_object('error','blocked');
  end if;

  select count(*) into confirmed_cnt from signups
   where session_id = s.id and gender = me.gender and status = 'confirmed';

  new_status := case when confirmed_cnt < s.capacity then 'confirmed' else 'waiting' end;

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, new_status)
  on conflict (session_id, user_id) do update
    set status = case when signups.status = 'cancelled' then excluded.status
                      else signups.status end;

  return json_build_object('status',
    (select status from signups where session_id = s.id and user_id = me.id));
end; $$;

-- ───────────────────────────────────────────────────────────────
--  8. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function blocked_with(uuid)                        from public, anon;
revoke execute on function block_user(uuid)                          from public, anon;
revoke execute on function unblock_user(uuid)                        from public, anon;
revoke execute on function my_blocks()                               from public, anon;
revoke execute on function report_user(uuid,text,text,text,uuid)     from public, anon;
revoke execute on function my_chats()                                from public, anon;
revoke execute on function chat_messages(uuid)                       from public, anon;
revoke execute on function chat_send(uuid,text)                      from public, anon;
revoke execute on function request_send(uuid,text)                   from public, anon;
revoke execute on function requests_received()                       from public, anon;
revoke execute on function requests_sent()                           from public, anon;
revoke execute on function inbox_counts()                            from public, anon;
revoke execute on function session_list()                            from public, anon;
revoke execute on function session_join(uuid)                        from public, anon;

grant execute on function
  blocked_with(uuid),
  block_user(uuid), unblock_user(uuid), my_blocks(),
  report_user(uuid,text,text,text,uuid),
  my_chats(), chat_messages(uuid), chat_send(uuid,text),
  request_send(uuid,text), requests_received(), requests_sent(),
  inbox_counts(), session_list(), session_join(uuid)
to authenticated;

-- blocked_with 를 authenticated 에게 주는 이유
--   RLS 정책은 소유자가 아니라 "조회하는 사람" 권한으로 평가된다.
--   profiles 정책이 이 함수를 부르므로, 권한을 막으면 사람 찾기 자체가
--   permission denied 로 죽는다.
--
--   대신 이 함수를 직접 호출하면 "저 사람이 나를 차단했나" 를 uuid 를
--   넣어가며 알아낼 수 있다. 다만 차단당하면 어차피 상대가 사람 찾기에서
--   사라지므로 새로 새는 정보는 아니다. uuid 를 이미 알아야 하는 것도
--   조건이라 위험은 낮다고 보고 감수한다.
