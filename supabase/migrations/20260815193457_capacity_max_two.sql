-- ═══════════════════════════════════════════════════════════════
--  정원을 1:1 · 2:2 로 제한 (3:3 제거)
-- ═══════════════════════════════════════════════════════════════
--
-- 왜 뺐나
--   정원은 상한이라 3:3 으로 열어도 2+2 만 오면 2:2 로 확정된다.
--   즉 3:3 은 "6명 필요" 가 아니라 "최대 6명" 이었는데,
--   선택지가 셋이면 방장이 고민만 늘고 지금 규모에서 6명이 모일 일도 드물다.
--
-- 폼에서만 막으면 REST API 로 직접 만들 수 있어 DB 에서도 막는다.

-- 기존 3:3 모임이 있으면 제약에 걸리므로 먼저 2:2 로 낮춘다.
-- (정원은 상한이라 참가자를 잃지 않는다 — 이미 3명이 확정된 성별이 있으면
--  초과분은 session_room 이 다음 모임 우선권 대상으로 처리한다.)
update sessions set capacity = 2 where capacity > 2;

alter table sessions drop constraint if exists sessions_capacity_check;
alter table sessions add constraint sessions_capacity_check
  check (capacity in (1, 2));
