-- 프로필에 구력(career) · 키(height) 추가
--
-- 배경
--   레벨만으로는 "6개월 만에 파랑"과 "3년 걸려 파랑"이 구분되지 않아 구력을 따로 받는다.
--   키는 선택 입력이고 표시만 한다 — 필터 항목으로 쓰지 않는다.
--
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
--   이미 있는 프로필을 깨지 않으려고 둘 다 nullable 로 넣는다.
--   (앱 폼에서는 구력을 필수로 받되, 기존 행은 빈 값이어도 조회가 된다.)

alter table profiles
  add column if not exists career int,
  add column if not exists height int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_career_check') then
    alter table profiles add constraint profiles_career_check
      check (career between 1 and 6);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_height_check') then
    alter table profiles add constraint profiles_height_check
      check (height between 130 and 220);
  end if;
end $$;
