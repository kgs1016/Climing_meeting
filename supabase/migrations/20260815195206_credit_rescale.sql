-- ═══════════════════════════════════════════════════════════════
--  크레딧 단위 재조정 — 1,000 단위 → 10 단위
-- ═══════════════════════════════════════════════════════════════
-- 관심(신청) 1회 = 10 크레딧 = 990원. 이 값을 기준으로 나머지를 맞춘다.
--   가입 이벤트  30 =  관심 3회
--   선착순 이벤트 100 = 관심 10회
--   등반 영상      2 = 모임당 1회
--
-- ⚠️ web/src/lib/supabase.ts 의 REQUEST_COST · CREDIT_SESSION_VIDEO 와
--    같은 값이어야 한다. 한쪽만 바꾸면 안내 문구가 실제 차감과 어긋난다.

create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 100  -- 선착순 (운영자가 수동 지급)
    when 'profile_complete' then 30   -- 가입 보너스
    when 'session_video'    then 2    -- 모임당 1회 (영상 여러 개 올려도 한 번)
    when 'request_extra'    then -10  -- 관심 1회
    -- 아래 둘은 로테이션 시절 규칙. 지금은 어디서도 적립하지 않는다.
    -- 지난 원장의 delta 는 각 행에 저장돼 있어 이 값과 무관하다.
    when 'mission_video'    then 0
    when 'mission_done'     then 0
    else 0
  end $$;

revoke execute on function credit_rule(text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────
--  이미 지급된 잔액은 건드리지 않는다.
-- ───────────────────────────────────────────────────────────────
-- 옛 단위(10,000 / 3,000)로 받은 사람이 있다면 새 단위에서는 1,000회
-- 분량이 된다. 정리가 필요하면 아래를 수동으로 실행할 것 —
-- 되돌릴 수 없으므로 대상자를 먼저 확인하고 쓴다.
--
--   insert into credit_ledger (user_id, delta, reason, ref)
--   select user_id, -round(sum(delta) * 0.99)::int, 'rescale', '011'
--     from credit_ledger group by user_id having sum(delta) > 0;
