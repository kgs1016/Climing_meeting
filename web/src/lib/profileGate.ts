/* 프로필 완성 게이트
   가입 직후 프로필(사진 포함)을 먼저 채우게 한다. 서로를 신뢰할 수 있는 상태에서만
   모임·사람을 볼 수 있어야 하고, 사진 없는 카드가 목록에 섞이는 것도 막힌다. */

import type { MyProfile } from "./myProfile";

/** 사람 찾기 공개·모임 이용에 반드시 있어야 하는 것들 */
export function missingFields(p: MyProfile): string[] {
  const missing: string[] = [];
  if (!p.photo) missing.push("대표 사진");
  if (!p.careerId) missing.push("구력");
  // 키는 뒤늦게 필수가 됐다. 이미 가입한 사람은 값이 비어 있어서
  // 여기에 걸리고, 프로필 화면에서 채우면 풀린다. (MBTI 는 선택)
  if (!p.height) missing.push("키");
  return missing;
}

export function isProfileComplete(p: MyProfile | null | undefined): boolean {
  return !!p && missingFields(p).length === 0;
}
