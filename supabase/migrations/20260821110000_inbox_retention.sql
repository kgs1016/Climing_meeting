-- ═══════════════════════════════════════════════════════════════
--  신청함 보존 기간 (7일) + 관심 거절·만료 환급
-- ═══════════════════════════════════════════════════════════════
-- 신청함에 거절·완료된 건이 무한히 쌓인다. 보존 기간을 7일로 정한다.
--
--   모임 신청  모임 "시작 시각 + 7일" 까지 보인다 — 만든 날짜 기준이면
--             2주 뒤 모임에 넣은 신청이 모임 전에 사라진다.
--   관심      보낸 지 7일까지 보인다. 답이 없는 관심은 7일에 자동 만료.
--
-- 만료는 숨김이 아니라 거절과 같은 처리다. 관심은 10크레딧을 걸고
-- 보낸 것이라, 그냥 숨기면 "거절되면 돌려드려요" 라는 안내와 달리
-- 크레딧이 영영 묶인다.
--
-- 그리고 그 안내가 지금까지 관심에는 거짓이었다 — session_join 은
-- 거절 시 반환하는데 request 는 반환 코드가 아예 없었다. 여기서
-- 거절·만료 둘 다 반환하게 맞춘다.

-- ───────────────────────────────────────────────────────────────
--  1. 금액 규칙 — 기존 값 전부 + 관심 반환
-- ───────────────────────────────────────────────────────────────
-- 20260817130000 의 정의를 대체한다. 값 전부를 들고 간다.
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 100
    when 'profile_complete' then 30
    when 'session_video'    then 2
    when 'request_extra'    then -10  -- 관심 1회
    when 'request_refund'   then 10   -- 관심 반환 (거절·만료)
    when 'session_join'     then -10  -- 모임 신청 1회
    when 'session_refund'   then 10   -- 모임 신청 반환
    when 'mission_video'    then 0
    when 'mission_done'     then 0
    else 0
  end $$;

revoke execute on function credit_rule(text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────
--  2. 관심 반환 — 낸 만큼만, 한 번만
-- ───────────────────────────────────────────────────────────────
-- 차감 원장의 ref 는 "상대id:epoch" 다. 한 쌍(from,to)당 관심은 한 번만
-- 보낼 수 있어서(unique) 차감도 최대 한 건이다. 반환의 ref 를 요청 id 로
-- 고정해 unique(user_id, reason, ref) 가 이중 반환을 막는다.
create or replace function request_fee_refund(p_request uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r requests; paid credit_ledger;
begin
  select * into r from requests where id = p_request;
  if not found then return 0; end if;

  select * into paid from credit_ledger
   where user_id = r.from_id and reason = 'request_extra'
     and ref like r.to_id::text || ':%'
   order by created_at desc limit 1;
  if not found then return 0; end if;   -- 공짜 시절의 관심

  insert into credit_ledger (user_id, delta, reason, ref)
  values (r.from_id, -paid.delta, 'request_refund', r.id::text)
  on conflict (user_id, reason, ref) do nothing;
  return -paid.delta;
end; $$;

-- 거절이 반환을 부른다. 20260810181218 의 request_respond 를 대체한다.
create or replace function request_respond(p_request uuid, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare r requests; a uuid; b uuid; mid uuid;
begin
  select * into r from requests where id = p_request for update;
  if not found or r.to_id <> auth.uid() then
    return json_build_object('error','not_allowed');
  end if;
  if r.status <> 'pending' then
    return json_build_object('error','already', 'status', r.status);
  end if;

  update requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_request;

  if not p_accept then
    perform request_fee_refund(p_request);
    return json_build_object('ok', true, 'accepted', false);
  end if;

  -- 수락 → 채팅방 개설 (모임 없이 생긴 매칭이라 session_id 는 NULL)
  a := least(r.from_id, r.to_id);
  b := greatest(r.from_id, r.to_id);

  insert into matches (session_id, user_a, user_b)
  values (null, a, b)
  on conflict do nothing;

  select id into mid from matches
   where session_id is null and user_a = a and user_b = b;

  return json_build_object('ok', true, 'accepted', true, 'match_id', mid);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. 만료 — 7일간 답 없는 관심
-- ───────────────────────────────────────────────────────────────
-- 반환하고 행을 지운다. 행을 남기면 unique(from,to) 때문에 같은 사람에게
-- 영영 다시 보낼 수 없다 — 상대가 거절한 게 아니라 못 본 것일 수 있으니
-- 자리를 비워 다음 기회를 남긴다. 돈 기록은 원장에 남는다.
create or replace function requests_expire()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select id from requests
     where status = 'pending' and created_at < now() - interval '7 days'
  loop
    perform request_fee_refund(r.id);
    delete from requests where id = r.id;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- 하루 한 번 자동 실행. jobname 이 같으면 갱신이라 몇 번 돌려도 안전하다.
create extension if not exists pg_cron;
select cron.schedule('requests-expire', '17 3 * * *', 'select public.requests_expire()');

-- ───────────────────────────────────────────────────────────────
--  4. 목록·배지에 7일 창을 건다
-- ───────────────────────────────────────────────────────────────
-- 아래 재정의들은 차단 필터(20260815223000 · 20260816233000)와
-- 닫힌 방 필터(20260820170000)를 전부 들고 간 최종본이다.
-- ⚠️ 이후 고칠 때 보존 기간·차단·closed_at 조건을 함께 들고 갈 것.

-- 받은 관심 — 만료 전(크론이 돌기 전)인 오래된 것도 미리 감춘다
create or replace function requests_received()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.message, r.status, r.created_at,
           p.id as from_id, p.nickname, p.age, p.level, p.career,
           p.height, p.home_gym, p.area, p.mbti, p.intro, p.photo
      from requests r join profiles p on p.id = r.from_id
     where r.to_id = auth.uid() and r.status = 'pending'
       and r.created_at > now() - interval '7 days'
       and not blocked_with(p.id)
  ) t;
$$;

-- 보낸 관심 — 7일이 지나면 결과와 무관하게 내린다
create or replace function requests_sent()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.created_at,
           case when r.status = 'accepted' then 'accepted' else 'pending' end as status,
           p.id as to_id, p.nickname, p.age, p.level, p.home_gym
      from requests r join profiles p on p.id = r.to_id
     where r.from_id = auth.uid()
       and r.created_at > now() - interval '7 days'
       and not blocked_with(p.id)
  ) t;
$$;

-- 신청한 모임 — 모임 시작 + 7일까지
create or replace function my_signups()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity, s.status as session_status,
           g.status as my_status,
           h.nickname as host_nickname, h.photo as host_photo
      from signups g
      join sessions s on s.id = g.session_id
      left join profiles h on h.id = s.host_id
     where g.user_id = auth.uid()
       and g.status <> 'cancelled'
       and s.host_id <> auth.uid()
       and s.starts_at > now() - interval '7 days'
       and (s.host_id is null or not blocked_with(s.host_id))
  ) t;
$$;

-- 배지 — 받은 관심 수가 목록과 같은 창을 봐야 한다
create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests r
                  where r.to_id = auth.uid() and r.status = 'pending'
                    and r.created_at > now() - interval '7 days'
                    and not blocked_with(r.from_id))
              + (select count(*) from json_array_elements(my_hosted_requests()))
              + (select count(*) from json_array_elements(my_confirm_proposals())),
    'likes', (select count(*) from requests r
               where r.to_id = auth.uid() and r.status = 'pending'
                 and r.created_at > now() - interval '7 days'
                 and not blocked_with(r.from_id)),
    'hosted', (select count(*) from json_array_elements(my_hosted_requests())),
    'proposals', (select count(*) from json_array_elements(my_confirm_proposals())),
    'sent_today', (select count(*) from requests
                    where from_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', request_daily_limit(),
    'unread_messages',
      (select count(*)
         from messages x
         join matches m on m.id = x.match_id
        where auth.uid() in (m.user_a, m.user_b)
          and m.closed_at is null
          and x.sender_id <> auth.uid()
          and not blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
          and x.created_at > coalesce(
                (select r.last_read_at from chat_reads r
                  where r.match_id = m.id and r.user_id = auth.uid()),
                '-infinity'::timestamptz))
      +
      (select count(*)
         from messages x
         join signups g on g.session_id = x.session_id and g.user_id = auth.uid()
         join sessions s on s.id = x.session_id
        where g.status = 'confirmed' and s.status = 'confirmed'
          and x.sender_id <> auth.uid()
          and not exists (
            select 1 from signups b
             where b.session_id = s.id and b.status = 'confirmed'
               and blocked_with(b.user_id))
          and x.created_at > coalesce(
                (select r.last_read_at from session_chat_reads r
                  where r.session_id = s.id and r.user_id = auth.uid()),
                '-infinity'::timestamptz)),
    'unread_rooms', (
      select count(*) from matches m
       where auth.uid() in (m.user_a, m.user_b)
         and m.closed_at is null
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
--  5. 권한
-- ───────────────────────────────────────────────────────────────
-- request_fee_refund · requests_expire 는 서버(크론·다른 함수)만 부른다.
revoke execute on function request_fee_refund(uuid) from public, anon, authenticated;
revoke execute on function requests_expire()       from public, anon, authenticated;
revoke execute on function request_respond(uuid,boolean) from public, anon;
grant execute on function request_respond(uuid,boolean) to authenticated;
