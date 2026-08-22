-- ═══════════════════════════════════════════════════════════════
--  MBTI 는 다시 선택으로 · 키만 필수로 남긴다
-- ═══════════════════════════════════════════════════════════════
-- 20260822120000 이 공개 조건에 키와 MBTI 를 같이 걸었는데, MBTI 는
-- 빼기로 했다. 그 파일을 고치지 않고 새로 쓰는 이유: 이미 적용된 DB 가
-- 있으면 CLI 가 다시 돌리지 않아 수정이 반영되지 않는다.
--
-- 그래서 어느 쪽이든 같은 결과가 되게 쓴다.
--   · 20260822120000 이 적용된 DB  → 제약을 바꿔 단다
--   · 아직 적용 안 된 DB          → 둘이 순서대로 돌아 같은 상태가 된다

alter table profiles drop constraint if exists profiles_public_needs_body;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_public_needs_height'
  ) then
    alter table profiles add constraint profiles_public_needs_height
      check (not is_public or height is not null);
  end if;
end $$;

-- 내려간 프로필을 여기서 되돌리지는 않는다. "MBTI 가 없어서 내려간 행" 과
-- "본인이 비공개를 택한 행" 을 구별할 방법이 없어서, 되살리려 들면 남의
-- 프로필을 임의로 공개하게 된다.
-- 프로필을 한 번 저장하면 is_public 이 true 로 올라가므로 스스로 풀린다.
