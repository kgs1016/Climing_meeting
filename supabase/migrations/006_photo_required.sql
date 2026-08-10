-- ═══════════════════════════════════════════════════════════════
--  사람 찾기 공개에는 대표 사진이 반드시 있어야 한다
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 왜 DB 에서 막나
--   폼에서만 검사하면 REST API 로 직접 upsert 해서 우회할 수 있다.
--   사람 찾기는 사진을 보고 고르는 곳이라, 사진 없는 카드가 섞이면 목록이 무너진다.

-- 1) 사진 없는 공개 프로필을 먼저 비공개로 내린다
--    (제약을 먼저 걸면 기존 행이 위반해서 ALTER 가 실패한다)
--    유저에게는 앱에서 "사진이 빠졌어요 → 지금 채우기" 배너로 안내된다.
update profiles set is_public = false where photo is null and is_public;

-- 2) 이후로는 사진 없이 공개할 수 없다
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_public_needs_photo'
  ) then
    alter table profiles add constraint profiles_public_needs_photo
      check (not is_public or photo is not null);
  end if;
end $$;
