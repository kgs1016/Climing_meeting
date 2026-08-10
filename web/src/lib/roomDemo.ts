/* 데모 모드 — /room/demo 로 들어오면 DB 없이 진행 화면을 그대로 본다.
   혼자서는 성비 2:2 를 만들 수 없어 실제 방을 열 수 없으므로,
   화면·문구·카드 로직을 눈으로 검증하려면 이 경로가 필요하다.

   실제 UI 컴포넌트를 그대로 쓰고 데이터만 가짜다. 서버 규칙(2:2 하한,
   라운드 시간 잠금)은 손대지 않는다 — 운영 로직을 테스트 목적으로
   느슨하게 만들면 그게 그대로 배포된다. */

import type { CardProfile } from "./matchCard";
import type { Room, RoomPartner } from "./supabase";

export const DEMO_ID = "demo";

export const DEMO_ME: CardProfile = {
  nickname: "나",
  age: 28,
  level: 3,
  career: 4,
  homeGym: "더클라임 연남",
  area: "연남동",
  mbti: "ENFP",
};

const PARTNERS: RoomPartner[] = [
  {
    // 겹치는 게 많은 상대 — 카드가 '일치'로 가득 차는 경우
    id: "demo-p1",
    nickname: "서연",
    age: 27,
    gender: "f",
    level: 3,
    career: 4,
    height: 164,
    home_gym: "더클라임 연남",
    area: "연남동",
    mbti: "ENFJ",
    intro: "주말 오후에 주로 타요. 같이 문제 풀어요!",
  },
  {
    // 실력·구력이 꽤 다른 상대 — 미션 난이도가 낮은 쪽으로 잡히는지
    id: "demo-p2",
    nickname: "민지",
    age: 31,
    gender: "f",
    level: 5,
    career: 6,
    height: 170,
    home_gym: "더월 연남",
    area: "연희동",
    mbti: "ISTJ",
    intro: null,
  },
  {
    // 구력 미입력(기존 유저) — null 이어도 줄만 빠지고 정상인지
    id: "demo-p3",
    nickname: "하은",
    age: 26,
    gender: "f",
    level: 2,
    career: null,
    height: null,
    home_gym: "써미트클라이밍",
    area: "상수동",
    mbti: "INFP",
    intro: "클라이밍 3개월차예요 🧗",
  },
];

/** 지금 시각 기준으로 R1·R2 는 열려 있고 R3 는 잠긴 상태를 만든다 */
export function buildDemoRoom(): Room {
  const now = Date.now();
  const min = 60_000;
  // 50분 전 시작 → 워밍업(20분) 끝 → R1(-30분) R2(0분) 열림 / R3(+30분) 잠김
  const startsAt = now - 50 * min;
  const iso = (ms: number) => new Date(ms).toISOString();

  const rounds = PARTNERS.map((p, i) => {
    const r = i + 1;
    const roundStart = startsAt + (20 + i * 30) * min;
    const cardOpen = roundStart - 5 * min;
    const isOpen = now >= cardOpen;
    return {
      round: r,
      starts_at: iso(roundStart),
      card_open_at: iso(cardOpen),
      is_open: isOpen,
      partner: isOpen ? p : null,
      mission_done: false,
    };
  });

  return {
    session: {
      id: DEMO_ID,
      gym: "더클라임 B홍대 (데모)",
      starts_at: iso(startsAt),
      ends_at: iso(startsAt + 110 * min),
      capacity: 3,
      intensity: "chill",
      after_meal: true,
    },
    me: { id: "demo-me", gender: "m", level: 3, slot: 0 },
    rounds,
    warmup_min: 20,
    room_ends_at: iso(startsAt + 110 * min),
    // 데모에선 최종선택 UI 까지 한 화면에서 보도록 열어둔다
    selection_open: true,
  };
}

/** 데모에서 상호매칭이 된 것처럼 보여줄 결과 */
export function demoMatches(pickedIds: Set<string>) {
  return PARTNERS.filter((p) => pickedIds.has(p.id)).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    age: p.age,
    level: p.level,
    career: p.career,
    home_gym: p.home_gym,
    area: p.area,
    mbti: p.mbti,
    intro: p.intro,
  }));
}
