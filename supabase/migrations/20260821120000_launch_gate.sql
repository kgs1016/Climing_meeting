-- ═══════════════════════════════════════════════════════════════
--  오픈 전 잠금 + 내부 테스터 우회
-- ═══════════════════════════════════════════════════════════════
-- 출시 직후 10일은 가입만 받고 기능을 닫는다 (첫 유저가 텅 빈 앱을
-- 보지 않게). 잠금 자체는 app_config(20260813184013)가 이미 한다 —
-- 여기서는 "잠겨 있어도 전체 앱을 쓰는 사람" 을 만든다.
--
--   · 운영자·동업자 — 닫힌 동안에도 내부 수정·테스트
--   · 애플 심사 계정 — 대기 화면만 보이면 기능 미달(4.2)로 리젝된다
--
-- 테스터 판정은 서버(app_flags)가 한다. 클라이언트는 평소처럼 플래그를
-- 읽을 뿐이라, 테스터에게는 "열려 있는 앱" 이 그대로 보인다.
--
-- ── 운영 SQL (대시보드 SQL Editor에서) ─────────────────────────
--
-- 잠그기 (출시 버튼 누르기 직전):
--   update app_config set sessions_open = false, people_open = false,
--          open_at = '2026-09-10', notice = '지금 가입하면 선착순 혜택!'
--    where id = 1;
--
-- 열기 (오픈일):
--   update app_config set sessions_open = true, people_open = true
--    where id = 1;
--
-- 테스터 추가 (가입된 계정의 이메일로):
--   insert into app_testers (user_id, note)
--   select id, '동업자' from auth.users where email = 'xxx@yyy.com'
--   on conflict do nothing;

create table if not exists app_testers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,                 -- 누구인지 (동업자 · 심사용 …)
  created_at timestamptz default now()
);

alter table app_testers enable row level security;
-- 정책 없음 = 직접 접근 차단. 운영자가 SQL 로만 넣고 뺀다.

create or replace function is_app_tester() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_testers where user_id = auth.uid())
$$;

-- 20260813184013 의 app_flags 를 대체한다 — 테스터에게는 항상 열린 값.
create or replace function app_flags()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'sessions_open', sessions_open or is_app_tester(),
    'people_open',   people_open   or is_app_tester(),
    'open_at', open_at,
    'notice', notice,
    'tester', is_app_tester()
  ) from app_config where id = 1;
$$;

revoke execute on function is_app_tester() from public, anon, authenticated;
-- create or replace 는 기존 권한을 유지하지만, 명시해 둔다
grant execute on function app_flags() to anon, authenticated;
