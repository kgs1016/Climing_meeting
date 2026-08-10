/* 공통점 카드 — 1:1 라운드 시작 5분 전에 뜨는 카드의 내용을 만든다.
   PRODUCT.md: Tier1 완전일치 → Tier2 부분겹침 → Tier3 흥미로운 차이
              → 상대가 쓴 답 원문 → 대화 씨앗 1개

   지금은 프로필에 있는 것(홈짐·동네·레벨·구력·MBTI·나이)만 재료로 쓴다.
   취향 설문 15문항이 붙으면 여기 Tier2 가 두꺼워진다. */

import { careerLabel, level, type CareerId, type LevelId } from "./levels";

export interface CardProfile {
  nickname: string;
  age: number;
  level: LevelId;
  career?: CareerId | null;
  homeGym: string;
  area: string;
  mbti: string;
  intro?: string | null;
}

export type Tier = "hit" | "mid" | "diff";

export interface CardRow {
  tier: Tier;
  text: string;
}

export interface MatchCard {
  rows: CardRow[];
  /** 상대가 직접 쓴 한마디 (있을 때만) */
  quote?: string;
  /** 대화 씨앗 — 가장 상위 겹침에서 만든다 */
  seed: string;
}

const TIER_ORDER: Record<Tier, number> = { hit: 0, mid: 1, diff: 2 };

/** 공백·대소문자 차이를 무시하고 비교 (사용자가 직접 입력하는 값이라) */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const MBTI_AXIS: [number, string, string][] = [
  [0, "E", "외향"],
  [1, "N", "직관"],
  [2, "F", "감정"],
  [3, "P", "즉흥"],
];

export function buildCard(me: CardProfile, you: CardProfile): MatchCard {
  const rows: CardRow[] = [];

  // ── 홈짐: 같으면 가장 강한 공통점 ──
  if (norm(me.homeGym) === norm(you.homeGym)) {
    rows.push({ tier: "hit", text: `둘 다 🧗 ${you.homeGym} 다녀요` });
  }

  // ── 동네 ──
  if (norm(me.area) === norm(you.area)) {
    rows.push({ tier: "hit", text: `둘 다 ${you.area} 살아요` });
  }

  // ── 구력 ──
  const myCareer = careerLabel(me.career);
  const yourCareer = careerLabel(you.career);
  if (myCareer && yourCareer) {
    if (me.career === you.career) {
      rows.push({ tier: "hit", text: `둘 다 구력 ${yourCareer}` });
    } else {
      rows.push({
        tier: "diff",
        text: `구력 — 나 ${myCareer} / 상대 ${yourCareer}`,
      });
    }
  }

  // ── 레벨 ──
  if (me.level === you.level) {
    rows.push({
      tier: "mid",
      text: `둘 다 L${you.level} ${level(you.level).name} (${level(you.level).colors})`,
    });
  } else {
    const low = level(Math.min(me.level, you.level) as LevelId);
    rows.push({
      tier: "diff",
      text: `실력이 조금 달라요 — 미션은 ${low.colors} 기준이에요`,
    });
  }

  // ── 나이 ──
  const gap = Math.abs(me.age - you.age);
  if (gap === 0) rows.push({ tier: "mid", text: `동갑이에요 (${you.age})` });
  else if (gap <= 2) rows.push({ tier: "mid", text: `나이 ${gap}살 차이` });

  // ── MBTI: 같은 축을 몇 개 공유하는지 ──
  if (me.mbti && you.mbti && me.mbti.length === 4 && you.mbti.length === 4) {
    if (me.mbti === you.mbti) {
      rows.push({ tier: "hit", text: `MBTI 완전 똑같아요 (${you.mbti})` });
    } else {
      const shared = MBTI_AXIS.filter(
        ([i]) => me.mbti[i] === you.mbti[i]
      ).map(([i, letter, word]) => (me.mbti[i] === letter ? word : null));
      const words = shared.filter(Boolean) as string[];
      if (words.length >= 2) {
        rows.push({ tier: "mid", text: `둘 다 ${words.join("·")}형 (${you.mbti})` });
      } else {
        rows.push({ tier: "diff", text: `MBTI 나 ${me.mbti} / 상대 ${you.mbti}` });
      }
    }
  }

  rows.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  return {
    rows,
    quote: you.intro?.trim() || undefined,
    seed: seedFrom(rows, you),
  };
}

/** 대화 씨앗 — 가장 상위 겹침을 질문으로 바꾼다 */
function seedFrom(rows: CardRow[], you: CardProfile): string {
  const top = rows[0];

  if (top?.tier === "hit") {
    if (top.text.includes("다녀요")) return "서로 자주 가는 시간대가 언제인지 물어보세요";
    if (top.text.includes("살아요")) return "동네에서 자주 가는 데가 있는지 물어보세요";
    if (top.text.includes("구력")) return "어쩌다 클라이밍을 시작했는지 물어보세요";
    if (top.text.includes("MBTI")) return "성격이 비슷하면 등반 스타일도 비슷한지 얘기해보세요";
  }

  if (you.intro?.trim()) return "상대가 쓴 한마디부터 물어보세요";

  return `${you.homeGym}은 어떤지 물어보세요`;
}
