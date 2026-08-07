/* 목데이터 — Supabase 연결 전까지 화면 검증용.
   실제 스키마는 PRODUCT.md의 데이터 모델 스케치를 따른다. */

import type { CareerId, LevelId } from "./levels";

export type Intensity = "chill" | "hard";
export type SessionStatus = "open" | "confirmed" | "closed";

export interface Session {
  id: string;
  gym: string;
  date: string; // "토 8/1"
  start: string; // "15:00"
  end: string; // "17:00"
  capacity: 2 | 3; // n:n
  levelMin: LevelId;
  levelMax: LevelId;
  ageMin: number; // 25 = 20대 중후반 시작점
  ageMax: number;
  intensity: Intensity;
  afterMeal: boolean;
  note?: string;
  maleJoined: number;
  femaleJoined: number;
  status: SessionStatus;
  isAway?: boolean; // 내 홈짐과 다른 짐 (🗺 원정)
}

export interface Person {
  id: string;
  nickname: string;
  age: number;
  gender: "m" | "f";
  level: LevelId;
  careerId?: CareerId;
  height?: number;
  homeGym: string;
  mbti: string;
  area: string;
}

export const MOCK_SESSIONS: Session[] = [
  {
    id: "s1",
    gym: "더클라임 B홍대",
    date: "토 8/1",
    start: "15:00",
    end: "17:00",
    capacity: 3,
    levelMin: 2,
    levelMax: 3,
    ageMin: 27,
    ageMax: 33,
    intensity: "chill",
    afterMeal: true,
    note: "가볍게 타고 맛있는 거 먹어요",
    maleJoined: 2,
    femaleJoined: 1,
    status: "open",
  },
  {
    id: "s2",
    gym: "더클라임 연남",
    date: "일 8/2",
    start: "11:00",
    end: "13:00",
    capacity: 2,
    levelMin: 1,
    levelMax: 2,
    ageMin: 24,
    ageMax: 29,
    intensity: "chill",
    afterMeal: false,
    note: "볼더링 처음이어도 환영! 같이 워밍업부터",
    maleJoined: 1,
    femaleJoined: 1,
    status: "open",
  },
  {
    id: "s3",
    gym: "홍대클라이밍",
    date: "토 8/1",
    start: "19:00",
    end: "21:00",
    capacity: 2,
    levelMin: 3,
    levelMax: 4,
    ageMin: 28,
    ageMax: 36,
    intensity: "hard",
    afterMeal: true,
    maleJoined: 2,
    femaleJoined: 2,
    status: "confirmed",
    isAway: true,
  },
  {
    id: "s4",
    gym: "써미트클라이밍",
    date: "수 8/5",
    start: "19:30",
    end: "21:00",
    capacity: 2,
    levelMin: 2,
    levelMax: 3,
    ageMin: 25,
    ageMax: 32,
    intensity: "chill",
    afterMeal: false,
    note: "퇴근하고 한 판!",
    maleJoined: 0,
    femaleJoined: 1,
    status: "open",
  },
];

export const MOCK_PEOPLE: Person[] = [
  { id: "p1", nickname: "서연", age: 27, gender: "f", level: 3, careerId: 4, height: 164, homeGym: "써미트클라이밍", mbti: "ENFP", area: "연남동" },
  { id: "p2", nickname: "지훈", age: 29, gender: "m", level: 3, careerId: 2, homeGym: "더클라임 연남", mbti: "ISTP", area: "망원동" },
  { id: "p3", nickname: "하은", age: 31, gender: "f", level: 2, careerId: 1, height: 158, homeGym: "더클라임 B홍대", mbti: "ISFJ", area: "상수동" },
  { id: "p4", nickname: "민지", age: 26, gender: "f", level: 4, careerId: 6, height: 170, homeGym: "더월 연남", mbti: "INTP", area: "연희동" },
];

export function slotsLeft(s: Session) {
  return {
    male: s.capacity - s.maleJoined,
    female: s.capacity - s.femaleJoined,
  };
}
