-- ═══════════════════════════════════════════════════════════════
--  데모 모임 채팅방 만들기 (화면 확인용)
-- ═══════════════════════════════════════════════════════════════
-- ⚠️ migrations 폴더가 아니다. db push 로 자동 실행되지 않는다.
--    대시보드 SQL Editor 에 붙여넣어 손으로 한 번만 돌린다.
--
-- 모임 채팅방은 정원이 다 차야 열린다. 혼자 테스트할 때는 상대가 없어서
-- 방이 안 열리므로, 여기서 상대역을 하나 만들어 1:1 모임을 채워준다.
--
-- 만드는 것
--   · 데모 상대 프로필 1개 (없을 때만)
--   · 🧪 데모 모임 1개 — 상대가 호스트, 정원 1:1, 내일 15:00
--   · 확정 신청 2건 (상대 + 나) → 정원이 차서 status = confirmed
--   · 대화 4줄
--
-- 지우려면 이 파일 맨 아래 "치우기" 를 돌린다.
--
-- 여러 번 돌려도 방이 여러 개 생기지 않는다 (돌릴 때마다 새로 만든다).

do $$
declare
  me    profiles;
  buddy profiles;
  uid   uuid;
  sid   uuid;
  t0    timestamptz := date_trunc('day', now()) + interval '1 day 15 hours';
begin
  ---------------------------------------------------------------
  -- 1. 내 프로필
  ---------------------------------------------------------------
  -- 기본값은 "가장 최근에 만든 프로필". 계정이 여러 개라 다른 걸 쓰고
  -- 싶으면 아래 한 줄을 닉네임으로 바꾼다.
  --   select * into me from profiles where nickname = '서연';
  select * into me from profiles order by created_at desc limit 1;

  if not found then
    raise exception '프로필이 하나도 없다. 앱에서 먼저 가입하고 프로필을 만들 것.';
  end if;

  ---------------------------------------------------------------
  -- 2. 상대역 — 이성 프로필이 이미 있으면 그걸 쓴다
  ---------------------------------------------------------------
  select * into buddy from profiles
   where gender <> me.gender and id <> me.id
   order by created_at desc limit 1;

  if not found then
    -- 없으면 만든다. profiles.id 가 auth.users 를 참조해서 계정부터 필요하다.
    -- 로그인하지 않는 표시용 계정이다.
    uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'demo-buddy@hobiday.test', crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '');

    -- is_public 은 false. 사진 없이 공개하면 profiles_public_needs_photo 에
    -- 걸리고, 사람 찾기 목록에 데모 카드가 섞이는 것도 막는다.
    -- 호스트 정보와 단체방 이름은 이 값과 무관하게 보인다.
    insert into profiles (id, nickname, gender, age, area, level, career,
                          height, home_gym, mbti, intro, is_public)
    values (uid,
            case when me.gender = 'm' then '서연(데모)' else '지훈(데모)' end,
            case when me.gender = 'm' then 'f' else 'm' end,
            27, '연남동', 3, 4, 168, '더클라임 연남', 'ENFP',
            '화면 확인용 데모 계정이에요', false);

    select * into buddy from profiles where id = uid;
  end if;

  ---------------------------------------------------------------
  -- 3. 데모 모임 — 이전에 만든 게 있으면 지우고 새로
  ---------------------------------------------------------------
  delete from sessions where gym = '🧪 데모 모임';

  insert into sessions (host_id, gym, starts_at, ends_at, capacity,
                        level_min, level_max, age_min, age_max,
                        intensity, after_meal, note, status)
  values (buddy.id, '🧪 데모 모임', t0, t0 + interval '90 minutes', 1,
          2, 3, 20, 45, 'chill', true,
          '채팅방 화면을 보려고 만든 모임이에요', 'open')
  returning id into sid;

  -- 정원 1:1 → 두 사람이 확정되면 꽉 찬다
  insert into signups (session_id, user_id, gender, status) values
    (sid, buddy.id, buddy.gender, 'confirmed'),
    (sid, me.id,    me.gender,    'confirmed');

  update sessions set status = 'confirmed' where id = sid;

  ---------------------------------------------------------------
  -- 4. 대화 몇 줄
  ---------------------------------------------------------------
  insert into messages (session_id, sender_id, body, created_at) values
    (sid, buddy.id, '안녕하세요! 내일 3시에 만나요 🧗', now() - interval '90 minutes'),
    (sid, me.id,    '네 좋아요, 시간 맞춰 갈게요',        now() - interval '80 minutes'),
    (sid, buddy.id, '신발은 대여 되니까 양말만 챙겨오세요', now() - interval '40 minutes'),
    (sid, buddy.id, '저는 조금 일찍 가서 몸 풀고 있을게요', now() - interval '5 minutes');

  raise notice '완료 — % 님 화면의 채팅 > 모임 채팅 에서 🧪 데모 모임 을 확인하세요', me.nickname;
end $$;


-- ═══════════════════════════════════════════════════════════════
--  치우기 — 데모를 다 보고 나면 아래 두 줄을 돌린다
-- ═══════════════════════════════════════════════════════════════
-- 모임을 지우면 신청·메시지는 on delete cascade 로 함께 사라진다.
--
--   delete from sessions where gym = '🧪 데모 모임';
--   delete from auth.users where email = 'demo-buddy@hobiday.test';
