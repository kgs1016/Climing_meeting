-- ═══════════════════════════════════════════════════════════════
--  로테이션 제거 — 확정 후 프로필 공개 + 자유 영상 인증
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 바뀐 것
--   - 라운드 시간표와 강제 짝 배정을 없앴다 (자유도 제한).
--   - 모임이 확정되면 참가자 프로필을 서로 볼 수 있다.
--     모임 목록은 여전히 블라인드다 — 신청 전에는 누가 있는지 모른다.
--   - 영상은 라운드/짝과 무관하게 각자 자유롭게 올린다.
--
-- 로테이션·공통점 카드 구현은 archive/rotation/ 에 보관돼 있다.

-- ───────────────────────────────────────────────────────────────
--  1. 자유 영상
-- ───────────────────────────────────────────────────────────────
-- missions 는 (session_id, round, user_id) 기본키에 partner_id NOT NULL 이라
-- 라운드 없는 구조를 담을 수 없다. 새 표를 쓴다.
create table if not exists session_videos (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  video_url  text not null,
  created_at timestamptz default now()
);

create index if not exists session_videos_idx
  on session_videos (session_id, user_id, created_at desc);

alter table session_videos enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.

-- ───────────────────────────────────────────────────────────────
--  2. 진행 화면 — 참가자 + 내 영상
-- ───────────────────────────────────────────────────────────────
create or replace function session_room(p_session uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare me profiles; s sessions; n int; mine boolean;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session;
  if not found then return json_build_object('error','not_found'); end if;

  select exists (
    select 1 from signups
     where session_id = p_session and user_id = me.id and status = 'confirmed'
  ) into mine;
  if not mine then return json_build_object('error','not_confirmed'); end if;

  -- 성비 기준 확정 인원. 0 이면 아직 상대가 없다.
  select least(
    (select count(*) from signups
      where session_id = p_session and gender = 'm' and status = 'confirmed'),
    (select count(*) from signups
      where session_id = p_session and gender = 'f' and status = 'confirmed')
  )::int into n;

  return json_build_object(
    'session', jsonb_build_object(
      'id', s.id, 'gym', s.gym, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'capacity', s.capacity, 'intensity', s.intensity, 'after_meal', s.after_meal,
      'note', s.note),
    'me', jsonb_build_object('id', me.id, 'gender', me.gender, 'level', me.level),
    'matched', n,
    -- 확정된 참가자는 서로 프로필을 본다. 모임 목록은 여전히 블라인드다.
    'people', coalesce((
      select json_agg(row_to_json(t) order by t.gender, t.nickname) from (
        select p.id, p.nickname, p.age, p.gender, p.level, p.career, p.height,
               p.home_gym, p.area, p.mbti, p.intro, p.photo,
               (p.id = me.id) as is_me
          from signups g join profiles p on p.id = g.user_id
         where g.session_id = p_session and g.status = 'confirmed'
      ) t), '[]'::json),
    'videos', coalesce((
      select json_agg(row_to_json(v) order by v.created_at desc) from (
        select id, video_url, created_at
          from session_videos
         where session_id = p_session and user_id = me.id
      ) v), '[]'::json),
    -- 모임 시작 시각이 지나면 최종선택을 연다
    'selection_open', now() >= s.starts_at
  );
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. 영상 올리기 — 라운드/짝 없이
-- ───────────────────────────────────────────────────────────────
-- 크레딧은 모임당 한 번만 준다. 영상 개수만큼 주면 잘게 쪼개 올려서
-- 무한히 벌 수 있다.
create or replace function session_video_add(p_session uuid, p_video text)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid(); earned int;
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;
  if nullif(trim(coalesce(p_video,'')), '') is null then
    return json_build_object('error','no_video');
  end if;

  if not exists (
    select 1 from signups
     where session_id = p_session and user_id = me_id and status = 'confirmed'
  ) then
    return json_build_object('error','not_confirmed');
  end if;

  insert into session_videos (session_id, user_id, video_url)
  values (p_session, me_id, trim(p_video));

  earned := credit_grant(me_id, 'session_video', p_session::text);

  return json_build_object('ok', true, 'earned', earned,
                           'balance', credit_balance(me_id));
end; $$;

create or replace function session_video_delete(p_video uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from session_videos where id = p_video and user_id = auth.uid();
  return json_build_object('ok', true);
end; $$;

-- 내 영상 보관함 (missions 기반 → session_videos 기반으로 교체)
create or replace function my_videos()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at desc), '[]'::json) from (
    select v.id, v.session_id, v.video_url, v.created_at, s.gym, s.starts_at
      from session_videos v join sessions s on s.id = v.session_id
     where v.user_id = auth.uid()
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 크레딧 규칙 — 영상 적립을 모임 단위로
-- ───────────────────────────────────────────────────────────────
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 10000  -- 선착순 (운영자가 수동 지급)
    when 'profile_complete' then 3000   -- 가입 보너스
    when 'session_video'    then 900    -- 모임당 1회 (영상 여러 개 올려도 한 번)
    when 'request_extra'    then -1000  -- 관심 1회
    -- 아래 둘은 로테이션 시절 규칙. 기존 원장 표시를 위해 값만 남긴다.
    when 'mission_video'    then 700
    when 'mission_done'     then 200
    else 0
  end $$;

-- ───────────────────────────────────────────────────────────────
--  5. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function credit_rule(text)                  from public, anon, authenticated;
revoke execute on function session_room(uuid)                 from public, anon;
revoke execute on function session_video_add(uuid,text)       from public, anon;
revoke execute on function session_video_delete(uuid)         from public, anon;
revoke execute on function my_videos()                        from public, anon;

grant execute on function
  session_room(uuid), session_video_add(uuid,text),
  session_video_delete(uuid), my_videos()
to authenticated;
