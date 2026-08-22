-- ═══════════════════════════════════════════════════════════════
--  키 · MBTI 를 필수로
-- ═══════════════════════════════════════════════════════════════
-- 하루 전 20260821150000 에서 동네·홈짐을 선택으로 풀면서 MBTI 도 선택으로
-- 뒀는데, 다시 필수로 돌린다. 동네·홈짐은 그대로 선택으로 둔다.
--
-- 왜 DB 에서도 막나
--   폼에서만 검사하면 REST API 로 직접 upsert 해서 우회할 수 있다.
--   사람 찾기는 이 값들을 보고 고르는 곳이라 빈 카드가 섞이면 목록이 무너진다.
--   photo 를 막을 때(20260810192536)와 같은 방식이다.

-- 1) 빈 문자열을 null 로 모은다
--    폼이 "선택 안 함" 을 '' 로 보내와서 두 가지 빈 값이 섞여 있다.
update profiles set mbti = null where mbti = '';

-- 2) 값이 빠진 공개 프로필을 먼저 비공개로 내린다
--    (제약을 먼저 걸면 기존 행이 위반해서 ALTER 가 실패한다)
--    유저에게는 앱에서 "키·MBTI 가 빠졌어요 → 지금 채우기" 게이트로 안내된다.
update profiles set is_public = false
 where is_public and (height is null or mbti is null);

-- 3) 이후로는 키·MBTI 없이 공개할 수 없다
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_public_needs_body'
  ) then
    alter table profiles add constraint profiles_public_needs_body
      check (not is_public or (height is not null and mbti is not null));
  end if;
end $$;
