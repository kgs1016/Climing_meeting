-- ═══════════════════════════════════════════════════════════════
--  호스트 공개 — 모임 목록·상세에서 개설자를 보여준다
-- ═══════════════════════════════════════════════════════════════
-- 소개 페이지는 "모임 목록에서 호스트 정보를 볼 수 있어요" 라고 안내하는데
-- 정작 화면에는 호스트가 한 번도 나오지 않았다.
--
-- 참가자는 지금처럼 확정 전까지 가린다. 호스트만 공개한다 —
-- 모임을 여는 행위 자체가 "내가 이 자리를 만들었다" 는 공개이기 때문이다.
--
-- 사람 찾기 공개 여부(is_public)와는 무관하게 보인다. security definer 라
-- RLS 를 지나지 않으므로, 내려주는 칸을 아래에서 직접 고른다.
-- 이메일·설문 같은 건 절대 넣지 않는다.

-- ───────────────────────────────────────────────────────────────
--  1. 모임 목록 — 호스트 요약을 함께 내려준다
-- ───────────────────────────────────────────────────────────────
-- 탈퇴한 호스트는 host_id 가 null 이 된다 (20260815203000_account_delete).
-- inner join 으로 묶으면 그 모임이 목록에서 통째로 사라지므로 left join.

create or replace function session_list()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity,
           s.level_min, s.level_max, s.age_min, s.age_max,
           s.intensity, s.after_meal, s.note, s.status,
           s.host_id,
           h.nickname as host_nickname,
           h.photo    as host_photo,
           h.age      as host_age,
           h.area     as host_area,
           h.level    as host_level,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select g.status from signups g
             where g.session_id = s.id and g.user_id = auth.uid()) as my_status
      from sessions s
      left join profiles h on h.id = s.host_id
     where s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  2. 호스트 상세 — 그 사람이 프로필에 적은 것들
-- ───────────────────────────────────────────────────────────────
-- 프로필 id 로 아무나 조회하게 열지 않는다. "이 모임의 호스트" 로만 닿을 수
-- 있게 세션을 통해서만 받는다. 볼 수 있는 모임의 범위는 목록과 같다.

create or replace function session_host(p_session uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s sessions; h profiles;
begin
  if auth.uid() is null then return json_build_object('error','auth'); end if;

  select * into s from sessions where id = p_session
     and status in ('open','confirmed','done')
     and starts_at > now() - interval '7 days';
  if not found then return json_build_object('error','not_found'); end if;

  select * into h from profiles where id = s.host_id;
  -- 호스트가 탈퇴하면 host_id 가 null 이 된다
  if not found then return json_build_object('error','left'); end if;

  return json_build_object(
    'id',       h.id,
    'nickname', h.nickname,
    'gender',   h.gender,
    'age',      h.age,
    'area',     h.area,
    'level',    h.level,
    'career',   h.career,
    'height',   h.height,
    'home_gym', h.home_gym,
    'mbti',     h.mbti,
    'intro',    h.intro,
    'photo',    h.photo,
    -- 이 사람이 지금까지 연 모임 수 — 처음 여는 사람인지 판단이 된다
    'hosted',   (select count(*) from sessions t where t.host_id = h.id));
end $$;

revoke execute on function session_list()        from public, anon;
revoke execute on function session_host(uuid)    from public, anon;
grant  execute on function session_list(), session_host(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────
--  3. 호스트 사진 읽기 허용
-- ───────────────────────────────────────────────────────────────
-- 사진 버킷은 비공개라 서명 URL 을 만들 때 select 권한을 본다. 기존 정책은
-- "내 사진 + is_public 인 사람" 만 허용해서, 사람 찾기에서 프로필을 내린
-- 호스트는 카드에 사진이 안 뜬다. 열려 있는 모임의 호스트를 예외로 둔다.

drop policy if exists "profile photos: read public" on storage.objects;
create policy "profile photos: read public" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from profiles
         where profiles.id::text = (storage.foldername(name))[1]
           and profiles.is_public
      )
      or exists (
        select 1 from sessions s
         where s.host_id::text = (storage.foldername(name))[1]
           and s.status in ('open','confirmed')
           and s.starts_at > now() - interval '3 hours'
      )
    )
  );
