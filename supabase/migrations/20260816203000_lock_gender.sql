-- ═══════════════════════════════════════════════════════════════
--  성별은 프로필을 만들 때 한 번만 고른다
-- ═══════════════════════════════════════════════════════════════
-- 성별은 이 앱에서 표시용이 아니라 판정 기준이다.
--
--   · 모임 확정      남녀 같은 수로만 성사된다
--   · 사람 찾기      이성만 목록에 뜬다
--   · 관심 보내기    이성에게만 보낼 수 있다
--   · signups.gender 신청한 시점의 성별이 따로 저장된다
--
-- 나중에 바꾸면 이미 쌓인 것들과 어긋난다. 확정된 모임의 성비가 깨지고,
-- signups 에 남은 값과 프로필이 달라진다. 화면에서만 막으면 REST 로
-- 직접 고칠 수 있으니 DB 에서 막는다.
--
-- 잘못 고른 경우엔 탈퇴 후 다시 가입한다. 프로필을 만들기 전이라면
-- (아직 profiles 행이 없으면) 얼마든지 고를 수 있다.

create or replace function profiles_gender_is_fixed()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.gender is distinct from old.gender then
    raise exception '성별은 바꿀 수 없어요'
      using errcode = 'check_violation',
            hint = '잘못 고르셨다면 탈퇴 후 다시 가입해주세요';
  end if;
  return new;
end $$;

drop trigger if exists profiles_gender_is_fixed on profiles;
create trigger profiles_gender_is_fixed
  before update of gender on profiles
  for each row execute function profiles_gender_is_fixed();
