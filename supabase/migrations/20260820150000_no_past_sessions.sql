-- ═══════════════════════════════════════════════════════════════
--  과거 시각 모임 개설 차단
-- ═══════════════════════════════════════════════════════════════
-- 지금은 어제 날짜로도 모임이 만들어진다. 목록은 "시작 3시간 전 이후"만
-- 보여주므로, 만든 사람은 성공 알림을 받고도 자기 모임을 영영 못 본다 —
-- 실수로 날짜를 잘못 고른 사람이 영문 모를 실종을 겪고, DB 엔 유령
-- 모임이 쌓인다.
--
-- 20260801000000 의 session_create 를 대체한다 (검사 두 줄 추가).
-- ⚠️ 이후 이 함수를 고칠 때 이 검사를 함께 들고 갈 것.

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

  -- 시작이 과거면 거부. 30분의 여유를 두는 이유: "지금 바로 모여요" 같은
  -- 즉석 모임까지 막고 싶지는 않다 — 시계 오차·입력 시간을 흡수한다.
  if p_starts_at < now() - interval '30 minutes' then
    return json_build_object('error','past');
  end if;
  -- 너무 먼 미래도 막는다 — 실수(연도 오타)로 2036년 모임이 생기는 것 방지
  if p_starts_at > now() + interval '90 days' then
    return json_build_object('error','too_far');
  end if;

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

revoke execute on function session_create(
  text,timestamptz,timestamptz,int,int,int,int,int,text,boolean,text) from public, anon;
grant execute on function session_create(
  text,timestamptz,timestamptz,int,int,int,int,int,text,boolean,text) to authenticated;

-- 이미 쌓인 유령 모임 정리 — 시작이 지났는데 확정도 안 된 open 모임
update sessions set status = 'cancelled'
 where status = 'open' and starts_at < now() - interval '3 hours';
