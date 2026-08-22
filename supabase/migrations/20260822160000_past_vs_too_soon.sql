-- ═══════════════════════════════════════════════════════════════
--  지난 시각과 임박을 구분해서 돌려준다
-- ═══════════════════════════════════════════════════════════════
-- 20260822140000 은 둘을 뭉쳐 'too_soon' 하나로 돌려줬다. 그래서 어제
-- 날짜를 골라도 "너무 임박했어요" 가 떠서 무슨 말인지 알 수 없었다.
--
--   starts < now              → past      "이미 지난 시각이에요"
--   now <= starts < now+30분  → too_soon  "너무 임박했어요"
--
-- ⚠️ create or replace 는 통째로 갈아친다. 20260822140000 의 나머지
--    (호스트 자동 참가 · 90일 제한 · 권한)를 그대로 들고 왔다.

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

  -- 지난 시각과 임박을 나눈다. 고쳐야 할 게 다르다 — 지난 건 잘못 고른
  -- 것이고, 임박은 제대로 골랐는데 규칙에 걸린 것이다.
  if p_starts_at < now() then
    return json_build_object('error','past');
  end if;
  -- 신청 · 호스트 승인 · 이동까지 최소한의 시간은 남겨둬야 한다
  if p_starts_at < now() + interval '30 minutes' then
    return json_build_object('error','too_soon');
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
