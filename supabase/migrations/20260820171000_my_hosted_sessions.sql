-- ═══════════════════════════════════════════════════════════════
--  내가 만든 모임 목록
-- ═══════════════════════════════════════════════════════════════
-- 호스트가 자기 모임을 다시 찾을 길이 지금은 홈 목록뿐인데, 홈은
-- "시작 3시간 전 이후 + open·confirmed" 만 보여준다. 지난 모임과
-- 취소한 모임은 어디서도 안 보인다 — 관리 화면이 없는 셈이다.
--
-- 차단 필터는 걸지 않는다: 내가 만든 모임은 참가자 중 누굴 차단했든
-- 내 것이니 항상 보여야 한다 (숨기면 삭제·관리를 못 한다).

create or replace function my_hosted_sessions()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at desc), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity, s.status,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.status = 'waiting') as waiting
      from sessions s
     where s.host_id = auth.uid()
     order by s.starts_at desc
     limit 100
  ) t;
$$;

revoke execute on function my_hosted_sessions() from public, anon;
grant execute on function my_hosted_sessions() to authenticated;
