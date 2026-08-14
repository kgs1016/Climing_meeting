-- ═══════════════════════════════════════════════════════════════
--  크레딧 — 미션으로 벌고, 관심 추가 발송에 쓴다
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 사용처를 왜 "관심 추가 발송" 으로 잡았나
--   PRODUCT.md 에서 크레딧 사용처는 수익 모델과 함께 보류 상태다.
--   결제·사업자등록 없이 지금 성립하는 유일한 순환이 신청권이고,
--   문서에도 "신청권·구독과 연결이 자연스럽다" 고 적혀 있다.
--   나중에 유료 상품이 생기면 사용처를 추가하면 된다.
--
-- 잔액을 따로 저장하지 않는 이유
--   원장(ledger) 합계로 계산한다. 잔액 컬럼을 두면 원장과 어긋날 때
--   어느 쪽이 맞는지 알 수 없다. 규모가 커지면 캐시를 붙이면 된다.

create table if not exists credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  delta      int  not null check (delta <> 0),
  reason     text not null,
  -- 같은 사건으로 두 번 적립되는 걸 막는 키 (예: 'session:round')
  ref        text not null default '',
  created_at timestamptz default now(),
  unique (user_id, reason, ref)
);

create index if not exists credit_ledger_user_idx on credit_ledger (user_id, created_at desc);

alter table credit_ledger enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.
-- 특히 클라이언트가 적립을 직접 넣을 수 있으면 크레딧이 의미가 없다.

-- ─────────── 적립·차감 금액 (한 곳에서 관리) ───────────
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'mission_video'    then 20   -- 영상까지 올린 미션
    when 'mission_done'     then 5    -- 영상 없이 완료 체크
    -- 가입 보너스. 무료 관심이 없으므로, 첫 모임에 나가기 전까지
    -- 아무도 못 만나고 막히지 않도록 관심 3회분을 준다.
    when 'profile_complete' then 100
    when 'request_extra'    then -30  -- 관심 1회
    else 0
  end $$;

-- 무료 제공분. 0 = 관심은 전부 크레딧으로만.
create or replace function request_daily_limit() returns int
  language sql immutable as $$ select 0 $$;

-- 내부용 적립 함수.
-- 이미 있는 (reason, ref) 면 0 을 반환한다 — 실제로 적립된 금액만 돌려줘야
-- 화면에서 "+20 받았어요" 가 거짓으로 뜨지 않는다.
create or replace function credit_grant(
  p_user uuid, p_reason text, p_ref text default '')
returns int language plpgsql security definer set search_path = public as $$
declare amt int := credit_rule(p_reason); ins int;
begin
  if amt = 0 then return 0; end if;
  insert into credit_ledger (user_id, delta, reason, ref)
  values (p_user, amt, p_reason, coalesce(p_ref, ''))
  on conflict (user_id, reason, ref) do nothing
  returning delta into ins;
  return coalesce(ins, 0);
end; $$;

create or replace function credit_balance(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from credit_ledger where user_id = p_user;
$$;

-- 내 잔액 + 최근 내역
create or replace function my_credits()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'balance', credit_balance(auth.uid()),
    'history', coalesce((
      select json_agg(row_to_json(t)) from (
        select delta, reason, created_at
          from credit_ledger
         where user_id = auth.uid()
         order by created_at desc
         limit 20
      ) t), '[]'::json)
  );
$$;

-- ─────────── 미션 완료 시 적립 ───────────
create or replace function mission_done(p_session uuid, p_round int, p_video text default null)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid(); pid uuid; room json; ref text; earned int := 0;
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;

  -- 상대는 서버가 계산한 값만 신뢰한다 (클라이언트가 보낸 상대를 쓰지 않는다)
  room := session_room(p_session);
  if room->>'error' is not null then return room; end if;

  select (r->'partner'->>'id')::uuid into pid
    from json_array_elements(room->'rounds') r
   where (r->>'round')::int = p_round and (r->>'is_open')::boolean;

  if pid is null then return json_build_object('error','round_not_open'); end if;

  insert into missions (session_id, round, user_id, partner_id, video_url, done)
  values (p_session, p_round, me_id, pid, nullif(trim(p_video), ''), true)
  on conflict (session_id, round, user_id) do update
    set done = true, video_url = coalesce(excluded.video_url, missions.video_url);

  -- 라운드마다 한 번씩만 적립된다 (원장 unique 로 보장)
  ref := p_session::text || ':' || p_round::text;
  earned := credit_grant(me_id, 'mission_done', ref);
  if nullif(trim(coalesce(p_video,'')), '') is not null then
    earned := earned + credit_grant(me_id, 'mission_video', ref);
  end if;

  return json_build_object('ok', true, 'earned', earned,
                           'balance', credit_balance(me_id));
end; $$;

-- ─────────── 관심 보내기: 한도 초과분은 크레딧으로 ───────────
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

-- ─────────── 프로필 첫 완성 보너스 ───────────
-- 사진까지 채운 프로필이 처음 완성된 시점에 한 번 적립한다.
create or replace function claim_profile_bonus()
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; earned int;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;
  if me.photo is null or me.career is null then
    return json_build_object('error','incomplete');
  end if;

  earned := credit_grant(me.id, 'profile_complete');
  return json_build_object('ok', true, 'earned', earned,
                           'balance', credit_balance(me.id));
end; $$;

-- ─────────── 권한 ───────────
-- credit_grant / credit_balance 는 내부용 — 클라이언트에 열지 않는다.
revoke execute on function credit_rule(text)                      from public, anon, authenticated;
revoke execute on function credit_grant(uuid,text,text)           from public, anon, authenticated;
revoke execute on function credit_balance(uuid)                   from public, anon, authenticated;
revoke execute on function my_credits()                           from public, anon;
revoke execute on function claim_profile_bonus()                  from public, anon;
revoke execute on function mission_done(uuid,int,text)            from public, anon;
revoke execute on function request_send(uuid,text)                from public, anon;

grant execute on function
  my_credits(), claim_profile_bonus(),
  mission_done(uuid,int,text), request_send(uuid,text)
to authenticated;
