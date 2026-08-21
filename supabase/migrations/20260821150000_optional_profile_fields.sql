-- ═══════════════════════════════════════════════════════════════
--  사는 동네 · 홈짐을 선택 항목으로
-- ═══════════════════════════════════════════════════════════════
-- 가입 문턱을 낮춘다 — 필수는 사진·구력(신뢰의 근거)만 남기고,
-- 동네·홈짐·MBTI 는 채우고 싶은 사람만. (mbti 는 원래 nullable)
-- 화면들은 이미 filter(Boolean) 으로 빈 값을 건너뛰게 되어 있다.

alter table profiles alter column area drop not null;
alter table profiles alter column home_gym drop not null;
