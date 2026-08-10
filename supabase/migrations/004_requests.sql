-- ═══════════════════════════════════════════════════════════════
--  사람 찾기 · 관심 보내기 → 수락 → 채팅
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 왜 바로 채팅이 아니라 수락을 거치나
--   무제한 DM 은 데이팅 앱에서 여성 이탈의 가장 확실한 경로다.
--   대신 한 줄 메시지를 붙일 수 있게 해서 받는 쪽이 맥락을 보고 판단하게 한다.
--
-- 왜 하루 한도가 있나
--   PRODUCT.md "신청권 수량 제한" — 무제한이면 도배가 된다.

-- ───────────────────────────────────────────────────────────────
--  1. 모임 없이 성립한 매칭도 채팅방을 가질 수 있게
-- ───────────────────────────────────────────────────────────────
alter table matches alter column session_id drop not null;

-- session_id 가 NULL 이면 unique (session_id, user_a, user_b) 가 안 걸린다
-- (Postgres 는 NULL 을 서로 다른 값으로 본다) → 부분 인덱스로 따로 막는다
create unique index if not exists matches_direct_uniq
  on matches (user_a, user_b) where session_id is null;

-- ───────────────────────────────────────────────────────────────
--  2. 관심 보내기
-- ───────────────────────────────────────────────────────────────
create table if not exists requests (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references profiles(id) on delete cascade,
  to_id      uuid not null references profiles(id) on delete cascade,
  message    text check (message is null or length(trim(message)) <= 200),
  status     text not null default 'pending'
             check (status in ('pending','accepted','declined')),
  created_at timestamptz default now(),
  responded_at timestamptz,
  unique (from_id, to_id),
  check (from_id <> to_id)
);

create index if not exists requests_to_idx on requests (to_id, status, created_at desc);

alter table requests enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.
-- 특히 "누가 나에게 관심을 보냈나" 는 수락 전까지 보낸 쪽이 알 수 없어야 한다.

create or replace function request_daily_limit() returns int
  language sql immutable as $$ select 5 $$;

-- 관심 보내기
create or replace function request_send(p_to uuid, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; you profiles; sent_today int; existing requests;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;
  if p_to = me.id then return json_build_object('error','self'); end if;

  select * into you from profiles where id = p_to;
  if not found then return json_build_object('error','not_found'); end if;
  -- 공개 프로필에만 보낼 수 있다 (사람 찾기에 올린 사람)
  if not you.is_public then return json_build_object('error','not_public'); end if;
  -- 이성에게만 (데이팅 전제 서비스)
  if you.gender = me.gender then return json_build_object('error','same_gender'); end if;

  select * into existing from requests where from_id = me.id and to_id = p_to;
  if found then
    return json_build_object('error','already', 'status', existing.status);
  end if;

  select count(*) into sent_today from requests
   where from_id = me.id and created_at > now() - interval '1 day';
  if sent_today >= request_daily_limit() then
    return json_build_object('error','limit', 'limit', request_daily_limit());
  end if;

  insert into requests (from_id, to_id, message)
  values (me.id, p_to, nullif(trim(p_message), ''));

  return json_build_object('ok', true,
    'left', request_daily_limit() - sent_today - 1);
end; $$;

-- 받은 관심 (수락 전에는 보낸 쪽 프로필을 보여줘야 판단이 된다)
create or replace function requests_received()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.message, r.status, r.created_at,
           p.id as from_id, p.nickname, p.age, p.level, p.career,
           p.height, p.home_gym, p.area, p.mbti, p.intro
      from requests r join profiles p on p.id = r.from_id
     where r.to_id = auth.uid() and r.status = 'pending'
  ) t;
$$;

-- 내가 보낸 관심 — 상대가 거절했는지는 알려주지 않는다.
-- 거절이 통보되면 보낸 쪽이 위축되고, 받는 쪽도 거절을 부담스러워한다.
create or replace function requests_sent()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.created_at,
           case when r.status = 'accepted' then 'accepted' else 'pending' end as status,
           p.id as to_id, p.nickname, p.age, p.level, p.home_gym
      from requests r join profiles p on p.id = r.to_id
     where r.from_id = auth.uid()
  ) t;
$$;

-- 수락 / 거절
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

  if not p_accept then return json_build_object('ok', true, 'accepted', false); end if;

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

-- 뱃지용 개수
create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests
                  where to_id = auth.uid() and status = 'pending'),
    'sent_today', (select count(*) from requests
                    where from_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', request_daily_limit()
  );
$$;

-- ───────────────────────────────────────────────────────────────
--  3. my_chats 갱신 — 모임 없이 생긴 방(session_id NULL)도 나와야 한다
-- ───────────────────────────────────────────────────────────────
create or replace function my_chats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json) from (
    select m.id as match_id,
           m.session_id,
           s.gym,                      -- 모임 없이 생긴 방이면 NULL
           p.id   as partner_id,
           p.nickname,
           p.age,
           p.level,
           p.home_gym,
           (select body from messages x
             where x.match_id = m.id order by x.created_at desc limit 1) as last_body,
           coalesce(
             (select max(created_at) from messages x where x.match_id = m.id),
             m.created_at) as last_at
      from matches m
      left join sessions s on s.id = m.session_id
      join profiles p
        on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
     where auth.uid() in (m.user_a, m.user_b)
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 권한 — PUBLIC 기본 EXECUTE 를 반드시 함께 회수
-- ───────────────────────────────────────────────────────────────
revoke execute on function request_send(uuid,text)        from public, anon;
revoke execute on function requests_received()            from public, anon;
revoke execute on function requests_sent()                from public, anon;
revoke execute on function request_respond(uuid,boolean)  from public, anon;
revoke execute on function inbox_counts()                 from public, anon;
revoke execute on function my_chats()                     from public, anon;

grant execute on function
  request_send(uuid,text), requests_received(), requests_sent(),
  request_respond(uuid,boolean), inbox_counts(), my_chats()
to authenticated;
