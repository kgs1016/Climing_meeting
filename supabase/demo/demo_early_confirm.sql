-- ═══════════════════════════════════════════════════════════════
--  데모: 조기 확정 (2:2 로 열렸는데 남 1 · 여 1)
-- ═══════════════════════════════════════════════════════════════
-- ⚠️ migrations 폴더가 아니다. db push 로 자동 실행되지 않는다.
--
-- 2:2 모임에 두 사람만 모인 상태를 만들어, 조기 확정 화면을 본다.
-- 맨 위 두 줄만 고쳐서 쓴다.
--
--   as_host = true   내가 호스트 → "🤝 1:1로 모임 확정하기" 버튼이 보인다
--   as_host = false  내가 게스트 → "호스트가 1:1로 하자고 해요" 카드가 보이고,
--                    받으면 실제로 확정되고 모임 채팅방이 열린다
--
-- 흐름을 끝까지 보려면 false 로 한 번 돌려서 직접 수락해보는 쪽이 낫다.
-- 상대 계정으로는 로그인할 수 없어서, true 로는 제안까지만 볼 수 있다.

do $$
declare
  my_nickname text    := '여기에_내_닉네임';   -- ← 내 프로필 닉네임
  as_host     boolean := false;                -- ← true 면 내가 호스트

  me    profiles;
  buddy profiles;
  uid   uuid;
  sid   uuid;
  t0    timestamptz := date_trunc('day', now()) + interval '2 days 15 hours';
begin
  select * into me from profiles where nickname = my_nickname;
  if not found then
    raise exception '닉네임 "%" 인 프로필이 없다. select nickname from profiles; 로 확인할 것.', my_nickname;
  end if;

  -- 상대역 — 이성 프로필이 있으면 그걸 쓰고, 없으면 만든다
  select * into buddy from profiles
   where gender <> me.gender and id <> me.id
   order by created_at desc limit 1;

  if not found then
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

    insert into profiles (id, nickname, gender, age, area, level, career,
                          height, home_gym, mbti, intro, is_public)
    values (uid,
            case when me.gender = 'm' then '서연(데모)' else '지훈(데모)' end,
            case when me.gender = 'm' then 'f' else 'm' end,
            27, '연남동', 3, 4, 168, '더클라임 연남', 'ENFP',
            '화면 확인용 데모 계정이에요', false);

    select * into buddy from profiles where id = uid;
  end if;

  delete from sessions where gym = '🧪 데모 2:2 모임';

  -- 정원 2:2 인데 두 사람만 확정 → 자리가 남아 있는 상태
  insert into sessions (host_id, gym, starts_at, ends_at, capacity,
                        level_min, level_max, age_min, age_max,
                        intensity, after_meal, note, status,
                        early_confirm_at)
  values (case when as_host then me.id else buddy.id end,
          '🧪 데모 2:2 모임', t0, t0 + interval '90 minutes', 2,
          2, 3, 20, 45, 'chill', false,
          '조기 확정 화면을 보려고 만든 모임이에요', 'open',
          -- 게스트 입장으로 볼 때는 제안이 이미 걸려 있어야 카드가 뜬다
          case when as_host then null else now() end)
  returning id into sid;

  insert into signups (session_id, user_id, gender, status) values
    (sid, me.id,    me.gender,    'confirmed'),
    (sid, buddy.id, buddy.gender, 'confirmed');

  raise notice '완료 — 모임 찾기에서 "🧪 데모 2:2 모임" 을 열어볼 것 (as_host = %)', as_host;
end $$;


-- ═══════════════════════════════════════════════════════════════
--  치우기
-- ═══════════════════════════════════════════════════════════════
--   delete from sessions where gym like '🧪 데모%';
--   delete from auth.users where email = 'demo-buddy@hobiday.test';
