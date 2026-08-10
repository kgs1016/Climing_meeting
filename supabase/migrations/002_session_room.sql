-- ═══════════════════════════════════════════════════════════════
--  모임 진행 화면 (PRODUCT.md F 화면)
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 설계 원칙 (PRODUCT.md "핵심 규칙")
--   - 라운드 페어링·상호매칭 판정은 반드시 서버에서. 클라이언트를 믿지 않는다.
--   - 상대 프로필은 그 라운드가 열린 뒤에만 내려보낸다.
--   - 선택(selections)은 누구에게도 직접 노출하지 않는다. 상호일 때만 결과를 준다.
--
-- 슬롯을 저장하지 않는 이유
--   확정자 중 신청순으로 매번 계산한다. 취소·승격이 일어나도 자동으로 다시 채워져
--   슬롯이 비는 일이 없다.

-- ─────────── 진행 파라미터 ───────────
-- 워밍업 20분 → 라운드당 30분, 카드는 라운드 시작 5분 전 공개
create or replace function room_warmup_min() returns int
  language sql immutable as $$ select 20 $$;
create or replace function room_round_min() returns int
  language sql immutable as $$ select 30 $$;
create or replace function room_card_lead_min() returns int
  language sql immutable as $$ select 5 $$;

-- ─────────── 미션 ───────────
create table if not exists missions (
  session_id uuid not null references sessions(id) on delete cascade,
  round      int  not null check (round between 1 and 3),
  user_id    uuid not null references profiles(id) on delete cascade,
  partner_id uuid not null references profiles(id) on delete cascade,
  video_url  text,
  done       boolean not null default false,
  created_at timestamptz default now(),
  primary key (session_id, round, user_id)
);

-- ─────────── 비공개 최종선택 ───────────
create table if not exists selections (
  session_id uuid not null references sessions(id) on delete cascade,
  chooser_id uuid not null references profiles(id) on delete cascade,
  chosen_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (session_id, chooser_id, chosen_id)
);

alter table missions   enable row level security;
alter table selections enable row level security;

-- 정책을 만들지 않는다 = 직접 접근 전면 차단.
-- 아래 security definer 함수로만 읽고 쓴다. 특히 selections 는 짝사랑이
-- 새어나가면 서비스가 망가지므로 절대 직접 조회를 열지 않는다.

-- ─────────── 내 진행 상태 ───────────
-- 라운드별 상대와 카드 공개 여부를 한 번에 내려준다.
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

  -- 내 슬롯 = 같은 성별 확정자 중 신청 순서 (0부터)
  select slot into my_slot from (
    select user_id, (row_number() over (order by created_at) - 1)::int as slot
      from signups
     where session_id = p_session and gender = me.gender and status = 'confirmed'
  ) t where t.user_id = me.id;

  if my_slot is null then return json_build_object('error','not_confirmed'); end if;

  -- 라운드 수 = min(남 확정, 여 확정). 성비가 안 맞으면 적은 쪽에 맞춘다.
  select least(
    (select count(*) from signups
      where session_id = p_session and gender = 'm' and status = 'confirmed'),
    (select count(*) from signups
      where session_id = p_session and gender = 'f' and status = 'confirmed')
  )::int into n;

  if n < 2 then return json_build_object('error','not_enough'); end if;

  -- 슬롯이 n 이상이면 초과 인원 (다음 모임 우선권 대상)
  if my_slot >= n then
    return json_build_object('error','overflow', 'session_id', p_session);
  end if;

  ends := s.starts_at + make_interval(mins => room_warmup_min() + n * room_round_min());

  for r in 1..n loop
    -- 남 i ↔ 여 (i + r - 1) % n  — n라운드로 모든 이성과 정확히 한 번씩
    if me.gender = 'm' then
      partner_slot := (my_slot + r - 1) % n;
    else
      partner_slot := (my_slot - r + 1 + n * r) % n;   -- 위 식의 역
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
    -- 마지막 라운드가 시작되면 선택 화면을 연다 (모든 상대를 이미 만난 시점)
    'selection_open', now() >= ends - make_interval(mins => room_round_min())
  );
end; $$;

-- ─────────── 미션 완료 ───────────
create or replace function mission_done(p_session uuid, p_round int, p_video text default null)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid(); pid uuid; room json;
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;

  -- 상대는 서버가 계산한 값만 신뢰한다 (클라이언트가 보낸 상대를 쓰지 않는다)
  room := session_room(p_session);
  if room->>'error' is not null then return room; end if;

  select (r->'partner'->>'id')::uuid into pid
    from json_array_elements(room->'rounds') r
   where (r->>'round')::int = p_round and (r->>'is_open')::boolean;

  if pid is null then return json_build_object('error','round_not_open'); end if;

  insert into missions (session_id, round, user_id, partner_id, video_url, done)
  values (p_session, p_round, me_id, pid, nullif(trim(p_video), ''), true)
  on conflict (session_id, round, user_id) do update
    set done = true, video_url = coalesce(excluded.video_url, missions.video_url);

  return json_build_object('ok', true);
end; $$;

-- ─────────── 비공개 최종선택 ───────────
-- 같은 모임에서 만난 이성만 고를 수 있다. 다시 제출하면 덮어쓴다.
create or replace function selection_submit(p_session uuid, p_chosen uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; valid uuid[];
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  if not exists (select 1 from signups
    where session_id = p_session and user_id = me.id and status = 'confirmed') then
    return json_build_object('error','not_confirmed');
  end if;

  -- 같은 모임 확정자 중 이성만 남긴다
  select coalesce(array_agg(g.user_id), '{}') into valid
    from signups g
   where g.session_id = p_session and g.status = 'confirmed'
     and g.gender <> me.gender
     and g.user_id = any(p_chosen);

  delete from selections where session_id = p_session and chooser_id = me.id;

  if array_length(valid, 1) is not null then
    insert into selections (session_id, chooser_id, chosen_id)
    select p_session, me.id, unnest(valid);
  end if;

  return json_build_object('ok', true, 'count', coalesce(array_length(valid,1), 0));
end; $$;

-- ─────────── 결과: 상호선택만 ───────────
-- 내가 골랐는지 여부는 절대 알려주지 않는다. 양쪽이 서로 고른 경우만 내려간다.
create or replace function my_matches(p_session uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select p.id, p.nickname, p.age, p.level, p.career, p.home_gym, p.area, p.mbti, p.intro
      from selections a
      join selections b
        on b.session_id = a.session_id
       and b.chooser_id = a.chosen_id
       and b.chosen_id  = a.chooser_id
      join profiles p on p.id = a.chosen_id
     where a.session_id = p_session and a.chooser_id = auth.uid()
  ) t;
$$;

-- ─────────── 권한 ───────────
-- PUBLIC 기본 EXECUTE 를 반드시 같이 회수해야 한다 (anon 이 PUBLIC 으로 상속받음)
revoke execute on function session_room(uuid)                    from public, anon;
revoke execute on function mission_done(uuid,int,text)            from public, anon;
revoke execute on function selection_submit(uuid,uuid[])          from public, anon;
revoke execute on function my_matches(uuid)                       from public, anon;

grant execute on function
  session_room(uuid), mission_done(uuid,int,text),
  selection_submit(uuid,uuid[]), my_matches(uuid)
to authenticated;
