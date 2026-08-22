-- ═══════════════════════════════════════════════════════════════
--  모임은 최소 30분 뒤부터 열 수 있다
-- ═══════════════════════════════════════════════════════════════
-- 20260820150000 은 반대였다 — 과거 30분까지 봐주고 있었다. 그래서 이미
-- 시작한 모임을 만들 수 있었고, 목록은 시작 3시간 뒤까지 보여주므로
-- 아무도 못 들어가는 모임이 떠 있었다. 호스트 승인제가 되면서 신청 →
-- 승인에 시간이 걸리니 더 문제였다.
--
--   before  ├─30분─┤ now ──────────→  전부 허용
--   after            now ├─30분─┤ 이후만 허용
--
-- ⚠️ create or replace 는 함수를 통째로 갈아친다. 20260820150000 의
--    나머지(호스트 자동 참가 · 90일 제한 · 권한)를 그대로 들고 왔다.

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

  -- 신청 · 호스트 승인 · 이동까지 최소한의 시간은 남겨둬야 한다.
  -- 여유가 앞이 아니라 뒤로 간다 — 자세한 건 파일 머리말.
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
