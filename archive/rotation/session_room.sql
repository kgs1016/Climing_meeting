-- ═══════════════════════════════════════════════════════════════
--  1:1 모임 허용 (정원 1)
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 왜 여는가
--   짐이 서울·경기로 흩어지면 min(남,여) >= 2 가 잘 안 만들어진다.
--   1:1 은 남 1 + 여 1 이면 열려서 초기 유동성 문제의 유일한 해법이다.
--
-- 대신 알고 있어야 할 것
--   - 상대가 한 명뿐이라 "매칭 실패 = 거절 확정" 이 된다.
--     3:3 에서 통하던 짝사랑 비노출이 1:1 에서는 성립하지 않는다.
--   - 첫 만남을 단둘이 하게 되므로 안전 안내가 더 중요해진다.

-- 정원 제약을 1까지 허용
alter table sessions drop constraint if exists sessions_capacity_check;
alter table sessions add constraint sessions_capacity_check
  check (capacity in (1, 2, 3));

-- 라운드 하한을 1 로 내린다.
-- n=1 이면 남0 ↔ 여0 한 쌍, 1라운드. 로테이션 공식은 그대로 성립한다.
create or replace function session_room(p_session uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  me profiles; s sessions;
  my_slot int; n int; r int;
  partner_slot int; pid uuid; p profiles;
  round_start timestamptz; card_open timestamptz; is_open boolean;
  arr jsonb := '[]'::jsonb;
  ends timestamptz;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session;
  if not found then return json_build_object('error','not_found'); end if;

  select slot into my_slot from (
    select user_id, (row_number() over (order by created_at) - 1)::int as slot
      from signups
     where session_id = p_session and gender = me.gender and status = 'confirmed'
  ) t where t.user_id = me.id;

  if my_slot is null then return json_build_object('error','not_confirmed'); end if;

  select least(
    (select count(*) from signups
      where session_id = p_session and gender = 'm' and status = 'confirmed'),
    (select count(*) from signups
      where session_id = p_session and gender = 'f' and status = 'confirmed')
  )::int into n;

  -- 1:1 부터 성립한다 (예전엔 2 미만이면 막았다)
  if n < 1 then return json_build_object('error','not_enough'); end if;

  if my_slot >= n then
    return json_build_object('error','overflow', 'session_id', p_session);
  end if;

  ends := s.starts_at + make_interval(mins => room_warmup_min() + n * room_round_min());

  for r in 1..n loop
    if me.gender = 'm' then
      partner_slot := (my_slot + r - 1) % n;
    else
      partner_slot := (my_slot - r + 1 + n * r) % n;
    end if;

    select user_id into pid from (
      select user_id, (row_number() over (order by created_at) - 1)::int as slot
        from signups
       where session_id = p_session
         and gender = case when me.gender = 'm' then 'f' else 'm' end
         and status = 'confirmed'
    ) t where t.slot = partner_slot;

    round_start := s.starts_at + make_interval(mins => room_warmup_min() + (r - 1) * room_round_min());
    card_open   := round_start - make_interval(mins => room_card_lead_min());
    is_open     := now() >= card_open;

    select * into p from profiles where id = pid;

    arr := arr || jsonb_build_object(
      'round', r,
      'starts_at', round_start,
      'card_open_at', card_open,
      'is_open', is_open,
      'partner', case when is_open and p.id is not null then jsonb_build_object(
          'id', p.id, 'nickname', p.nickname, 'age', p.age, 'gender', p.gender,
          'level', p.level, 'career', p.career, 'height', p.height,
          'home_gym', p.home_gym, 'area', p.area, 'mbti', p.mbti, 'intro', p.intro
        ) else null end,
      'mission_done', coalesce(
        (select done from missions
          where session_id = p_session and round = r and user_id = me.id), false)
    );
  end loop;

  return json_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'gym', s.gym, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'capacity', s.capacity, 'intensity', s.intensity, 'after_meal', s.after_meal),
    'me', jsonb_build_object(
      'id', me.id, 'gender', me.gender, 'level', me.level, 'slot', my_slot),
    'rounds', arr,
    'warmup_min', room_warmup_min(),
    'room_ends_at', ends,
    'selection_open', now() >= ends - make_interval(mins => room_round_min())
  );
end; $$;

revoke execute on function session_room(uuid) from public, anon;
grant execute on function session_room(uuid) to authenticated;
