-- ═══════════════════════════════════════════════════════════════
--  HOBIDAY 스키마 v3 — 세션(모임) 기반 상시 매칭 (PRODUCT.md 기준)
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run
--
--  ⚠️ 몇 번을 다시 돌려도 안전하다 (idempotent).
--     create policy 는 if not exists 를 지원하지 않아 매번 drop 후 재생성한다.
--
--  v3 변경점
--   - 비로그인(anon)은 아무것도 못 본다. 프로필·모임 조회 전부 authenticated 전용.
--     (v2 는 profiles select 에 to authenticated 가 빠져 있어 공개키만으로
--      전체 프로필이 조회됐다. 나이+성별+동네+홈짐이면 사실상 신원 특정이 된다.)
--   - 프로필에 career(구력) · height(키) 추가
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────── 프로필 ───────────
create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  nickname   text not null,
  gender     text not null check (gender in ('m','f')),
  age        int  not null check (age between 19 and 60),
  area       text not null,
  level      int  not null check (level between 1 and 5),   -- L1~L5
  career     int       check (career between 1 and 6),      -- 구력 (CAREERS)
  height     int       check (height between 130 and 220),  -- 키(cm) · 선택 · 필터 아님
  home_gym   text not null,
  mbti       text,
  intro      text,
  is_public  boolean not null default false,                -- 사람 찾기 공개 여부
  survey     jsonb   not null default '{}'::jsonb,          -- 취향 설문 (카드 재료)
  created_at timestamptz default now()
);

-- v2 로 이미 만든 DB 를 위한 보강 (새로 만든 경우엔 아무 일도 안 함)
alter table profiles
  add column if not exists career int,
  add column if not exists height int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_career_check') then
    alter table profiles add constraint profiles_career_check check (career between 1 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_height_check') then
    alter table profiles add constraint profiles_height_check check (height between 130 and 220);
  end if;
end $$;

alter table profiles enable row level security;

drop policy if exists "profiles: own all" on profiles;
create policy "profiles: own all" on profiles
  for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- 사람 찾기: 공개 프로필은 "로그인한" 유저만 조회 가능
drop policy if exists "profiles: public readable" on profiles;
create policy "profiles: public readable" on profiles
  for select to authenticated
  using (is_public = true or auth.uid() = id);

-- ─────────── 모임(세션) ───────────
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references profiles(id) on delete cascade,
  gym        text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  capacity   int  not null check (capacity in (2,3)),        -- n:n
  level_min  int  not null check (level_min between 1 and 5),
  level_max  int  not null check (level_max between 1 and 5),
  age_min    int  not null,
  age_max    int  not null,
  intensity  text not null default 'chill' check (intensity in ('chill','hard')),
  after_meal boolean not null default false,
  note       text,
  status     text not null default 'open'
             check (status in ('open','confirmed','cancelled','done')),
  created_at timestamptz default now(),
  check (level_max >= level_min and level_max - level_min <= 1),  -- 인접 1단계
  check (ends_at > starts_at)
);

alter table sessions enable row level security;

-- 모임도 로그인해야 보인다 (개인정보는 아니지만 "가입 후 이용" 원칙)
drop policy if exists "sessions: readable" on sessions;
create policy "sessions: readable" on sessions
  for select to authenticated using (true);
-- 생성·신청은 RPC로만 (아래 security definer 함수)

-- ─────────── 신청 ───────────
create table if not exists signups (
  session_id uuid not null references sessions(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  gender     text not null check (gender in ('m','f')),
  status     text not null default 'waiting'
             check (status in ('waiting','confirmed','cancelled','cut')),
  created_at timestamptz default now(),
  primary key (session_id, user_id)
);

alter table signups enable row level security;

drop policy if exists "signups: own readable" on signups;
create policy "signups: own readable" on signups
  for select to authenticated using (auth.uid() = user_id);

-- ─────────── RPC ───────────

-- 모임 목록 (블라인드: 확정 인원 수만 노출, 누구인지는 비공개)
create or replace function session_list()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity,
           s.level_min, s.level_max, s.age_min, s.age_max,
           s.intensity, s.after_meal, s.note, s.status,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select g.status from signups g
             where g.session_id = s.id and g.user_id = auth.uid()) as my_status
      from sessions s
     where s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
  ) t;
$$;

-- 모임 만들기: 세션 생성 + 개설자 자동 확정 신청 (원자적)
create or replace function session_create(
  p_gym text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_capacity int, p_level_min int, p_level_max int,
  p_age_min int, p_age_max int, p_intensity text,
  p_after_meal boolean, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; sid uuid;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  insert into sessions (host_id, gym, starts_at, ends_at, capacity,
                        level_min, level_max, age_min, age_max,
                        intensity, after_meal, note)
  values (me.id, p_gym, p_starts_at, p_ends_at, p_capacity,
          p_level_min, p_level_max, p_age_min, p_age_max,
          p_intensity, p_after_meal, nullif(trim(p_note), ''))
  returning id into sid;

  insert into signups (session_id, user_id, gender, status)
  values (sid, me.id, me.gender, 'confirmed');

  return json_build_object('id', sid);
end; $$;

-- 모임 신청: 성비 슬롯 — 내 성별 확정 수 < capacity 면 즉시 확정, 아니면 대기
-- (여성 즉시확정/남성 대기열은 이 슬롯 구조에서 자연히 발생)
create or replace function session_join(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; s sessions; confirmed_cnt int; new_status text;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session for update;
  if not found or s.status not in ('open','confirmed') then
    return json_build_object('error','not_open');
  end if;
  if s.host_id = me.id then return json_build_object('error','is_host'); end if;

  select count(*) into confirmed_cnt from signups
   where session_id = s.id and gender = me.gender and status = 'confirmed';

  new_status := case when confirmed_cnt < s.capacity then 'confirmed' else 'waiting' end;

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, new_status)
  on conflict (session_id, user_id) do update
    set status = case when signups.status = 'cancelled' then excluded.status
                      else signups.status end;

  return json_build_object('status',
    (select status from signups where session_id = s.id and user_id = me.id));
end; $$;

-- 신청 취소: 확정자가 빠지면 같은 성별 대기 1순위를 자동 승격
create or replace function session_cancel(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid(); my signups; nxt signups;
begin
  select * into my from signups
   where session_id = p_session and user_id = me_id for update;
  if not found or my.status = 'cancelled' then
    return json_build_object('error','not_joined');
  end if;

  update signups set status = 'cancelled'
   where session_id = p_session and user_id = me_id;

  if my.status = 'confirmed' then
    select * into nxt from signups
     where session_id = p_session and gender = my.gender and status = 'waiting'
     order by created_at limit 1;
    if found then
      update signups set status = 'confirmed'
       where session_id = nxt.session_id and user_id = nxt.user_id;
    end if;
  end if;

  return json_build_object('ok', true);
end; $$;

-- 내 신청함
create or replace function my_signups()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, g.status as my_status
      from signups g join sessions s on s.id = g.session_id
     where g.user_id = auth.uid() and g.status <> 'cancelled'
  ) t;
$$;

-- ─────────── 권한 ───────────
-- security definer 함수는 RLS 를 우회한다. anon 이 실행할 수 있으면 위의 정책이
-- 전부 무의미해지므로 반드시 막아야 한다.
--
-- ⚠️ 함정 둘
--   1) Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 자동으로 준다.
--      anon 에서만 revoke 하면 PUBLIC 경로로 그대로 실행된다. public 을 꼭 포함할 것.
--   2) "all functions in schema public" 로 뭉뚱그리면 pgcrypto 같은 확장 함수까지
--      건드린다. 우리 함수만 하나씩 지정한다.

revoke execute on function session_list() from public, anon;
revoke execute on function session_create(
  text,timestamptz,timestamptz,int,int,int,int,int,text,boolean,text) from public, anon;
revoke execute on function session_join(uuid)   from public, anon;
revoke execute on function session_cancel(uuid) from public, anon;
revoke execute on function my_signups()         from public, anon;

grant execute on function
  session_list(),
  session_create(text,timestamptz,timestamptz,int,int,int,int,int,text,boolean,text),
  session_join(uuid), session_cancel(uuid), my_signups()
to authenticated;
