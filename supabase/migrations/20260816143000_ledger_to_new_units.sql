-- ═══════════════════════════════════════════════════════════════
--  지난 원장도 새 단위로 — 보정 줄 대신 금액 자체를 고친다
-- ═══════════════════════════════════════════════════════════════
-- 20260815213000_rescale_balances.sql 은 잔액만 맞추고 지난 줄은 옛 금액
-- 그대로 뒀다. 그래서 내 정보 · 크레딧 내역이 이렇게 보였다.
--
--   🧗 프로필 완성        +3,000     ← 옛 단위
--   💌 관심 보내기        -1,000     ← 옛 단위
--   🔁 크레딧 단위 변경   -1,980     ← 위 둘을 상쇄하려고 넣은 보정 줄
--
-- 원장은 원래 지난 일을 고치지 않는 게 맞다. 다만 아직 오픈 전이고
-- 계정도 전부 테스트용이라, 보정 줄로 설명하는 것보다 금액을 지금 규칙으로
-- 맞추는 쪽이 화면이 정직해진다. 오픈 뒤에는 이렇게 하지 않는다.
--
--   🧗 프로필 완성          +30
--   💌 관심 보내기          -10
--
-- 몇 번을 다시 돌려도 결과가 같다 (이미 맞는 줄은 건드리지 않는다).

-- ───────────────────────────────────────────────────────────────
--  1. 금액 규칙 — 아직 적용 전일 수 있으니 여기서 한 번 더 확정한다
-- ───────────────────────────────────────────────────────────────
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 100
    when 'profile_complete' then 30
    when 'session_video'    then 2
    when 'request_extra'    then -10
    when 'mission_video'    then 0
    when 'mission_done'     then 0
    else 0
  end $$;

revoke execute on function credit_rule(text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────
--  2. 지난 줄을 지금 규칙 금액으로
-- ───────────────────────────────────────────────────────────────
-- 규칙이 0 인 사유(mission_*)는 제외한다. delta <> 0 제약에 걸리고,
-- 로테이션 시절 적립이라 지금 규칙으로 금액을 매길 수도 없다.

update credit_ledger
   set delta = credit_rule(reason)
 where reason in ('early_bird','profile_complete','session_video','request_extra')
   and delta <> credit_rule(reason);

-- ───────────────────────────────────────────────────────────────
--  3. 보정 줄 삭제
-- ───────────────────────────────────────────────────────────────
-- 2번에서 금액을 직접 맞췄으니 상쇄할 게 없다. 남겨두면 잔액이 두 번 깎인다.

delete from credit_ledger where reason = 'rescale';
