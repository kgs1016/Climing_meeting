-- ═══════════════════════════════════════════════════════════════
--  사전 모집 — 크레딧 단위 재조정 · 선착순 보너스 · 기능 잠금
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
--  ⚠️ 008_credits.sql 을 먼저 실행한 상태여야 한다.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  1. 크레딧 단위 재조정 (1크레딧 ≈ 1원 감각)
-- ───────────────────────────────────────────────────────────────
-- 선착순 10,000 을 기준으로 전체를 다시 잡았다. 서로의 비율은 이전과 같다.
--   관심 1회 = 1,000 → 선착순 보너스로 10회, 가입 보너스로 3회 보낼 수 있다.
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 10000  -- 선착순 (성별 각 30명)
    when 'profile_complete' then 3000   -- 가입 보너스
    when 'mission_video'    then 700    -- 영상까지 올린 미션
    when 'mission_done'     then 200    -- 영상 없이 완료 체크
    when 'request_extra'    then -1000  -- 관심 1회
    else 0
  end $$;

-- ───────────────────────────────────────────────────────────────
--  2. 선착순 — 성별로 각각 N명
-- ───────────────────────────────────────────────────────────────
-- 성별을 나누지 않으면 한쪽이 자리를 다 차지해서 2:2 조차 못 만든다.
create or replace function early_bird_slots() returns int
  language sql immutable as $$ select 30 $$;

-- 남은 자리 — 운영자 확인용. 랜딩에 노출하지 않으므로 anon 에게 열지 않는다.
-- (초기엔 "남 30명 남음" 이 곧 "아무도 안 왔다" 는 신호가 되어 역효과)
create or replace function early_bird_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'slots', early_bird_slots(),
    'taken_m', (select count(*) from credit_ledger l join profiles p on p.id = l.user_id
                 where l.reason = 'early_bird' and p.gender = 'm'),
    'taken_f', (select count(*) from credit_ledger l join profiles p on p.id = l.user_id
                 where l.reason = 'early_bird' and p.gender = 'f')
  );
$$;

-- 프로필 완성 시 가입 보너스 + (자리가 남았으면) 선착순 보너스
create or replace function claim_profile_bonus()
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; earned int := 0; taken int; early int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;
  if me.photo is null or me.career is null then
    return json_build_object('error','incomplete');
  end if;

  earned := credit_grant(me.id, 'profile_complete');

  -- 동시 가입이 같은 자리를 함께 통과하지 못하게 성별로 잠근다
  perform pg_advisory_xact_lock(hashtext('early_bird:' || me.gender));

  select count(*) into taken
    from credit_ledger l join profiles p on p.id = l.user_id
   where l.reason = 'early_bird' and p.gender = me.gender;

  if taken < early_bird_slots() then
    early := credit_grant(me.id, 'early_bird');
    earned := earned + early;
  end if;

  return json_build_object('ok', true, 'earned', earned, 'early_bird', early > 0,
                           'balance', credit_balance(me.id));
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. 기능 잠금 스위치
-- ───────────────────────────────────────────────────────────────
-- 오픈 전에는 가입·프로필만 열고 모임·사람은 잠근다.
-- 배포 없이 이 표의 값만 바꿔서 켜고 끌 수 있다.
create table if not exists app_config (
  id            int primary key default 1 check (id = 1),
  sessions_open boolean not null default false,
  people_open   boolean not null default false,
  open_at       timestamptz,
  notice        text
);

insert into app_config (id, sessions_open, people_open, open_at, notice)
values (1, false, false, '2026-08-31 10:00+09',
        '8월 31일에 모임이 열려요. 그때까지 크레딧을 모아두세요!')
on conflict (id) do nothing;

alter table app_config enable row level security;

-- 잠금 상태는 비로그인도 알아야 한다 (랜딩·게이트 화면)
create or replace function app_flags()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'sessions_open', sessions_open,
    'people_open', people_open,
    'open_at', open_at,
    'notice', notice
  ) from app_config where id = 1;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function credit_rule(text)       from public, anon, authenticated;
revoke execute on function early_bird_slots()      from public, anon, authenticated;
revoke execute on function claim_profile_bonus()   from public, anon;
revoke execute on function early_bird_status()     from public, anon;
revoke execute on function app_flags()             from public;

grant execute on function claim_profile_bonus() to authenticated;
-- 선착순 현황은 운영자만 (대시보드 SQL Editor 에서 조회)
grant execute on function early_bird_status() to authenticated;
-- 잠금 플래그는 로그인 전 화면에서도 읽어야 한다
grant execute on function app_flags() to anon, authenticated;
