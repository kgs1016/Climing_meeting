/* 레벨 체계 L1~L5 — PRODUCT.md 기준 (더클라임 색 + V등급, 도달 기간 미표기) */

export type LevelId = 1 | 2 | 3 | 4 | 5;

export interface Level {
  id: LevelId;
  name: string;
  colors: string;
  vgrade: string;
}

export const LEVELS: Level[] = [
  { id: 1, name: "입문", colors: "흰·노랑", vgrade: "Vb~V0-" },
  { id: 2, name: "초급", colors: "주황·초록", vgrade: "V0~V0+" },
  { id: 3, name: "중급", colors: "파랑", vgrade: "V1~V2" },
  { id: 4, name: "중상급", colors: "빨강·핑크", vgrade: "V3~V5" },
  { id: 5, name: "상급", colors: "보라 이상", vgrade: "V6+" },
];

export const level = (id: LevelId) => LEVELS[id - 1];

/** "L2 초급 ~ L3 중급 (주황·초록·파랑)" */
export function levelRangeLabel(min: LevelId, max: LevelId): string {
  const colors = LEVELS.slice(min - 1, max)
    .map((l) => l.colors)
    .join("·");
  if (min === max) return `L${min} ${level(min).name} (${level(min).colors})`;
  return `L${min} ${level(min).name} ~ L${max} ${level(max).name} (${colors})`;
}

/** 미션 난이도 = 두 사람 중 낮은 레벨 기준 */
export function missionLevel(a: LevelId, b: LevelId): Level {
  return level(Math.min(a, b) as LevelId);
}
