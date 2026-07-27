/* 내 프로필 — 목데이터 단계에선 localStorage, Supabase 연결 시 교체 */

import type { LevelId } from "./levels";

export interface MyProfile {
  nickname: string;
  gender: "m" | "f";
  age: number;
  area: string;
  level: LevelId;
  homeGym: string;
  mbti: string;
  intro?: string;
}

const KEY = "hobiday.myProfile";

export function loadMyProfile(): MyProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MyProfile) : null;
  } catch {
    return null;
  }
}

export function saveMyProfile(p: MyProfile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function removeMyProfile() {
  localStorage.removeItem(KEY);
}
