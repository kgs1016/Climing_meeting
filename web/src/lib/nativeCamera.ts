"use client";

/* 네이티브 사진 선택 (현재 미사용).
 *
 *  써봤더니 플러그인의 선택창이 iOS 기본 파일 선택 시트("사진 보관함/
 *  사진 찍기/파일 선택", 한국어)보다 나빴다 — 영어인 데다 보관함 버튼이
 *  동작하지 않았다. 프로필 사진은 <input type="file"> 로 되돌렸고,
 *  이 모듈은 나중에 "촬영 전용 버튼" 같은 게 필요해지면 다시 쓴다.
 */

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";

/** 네이티브면 OS 사진 UI 로 받아 File 로 돌려준다. 웹이면 null (기존 input 사용).
 *  사용자가 취소하면 "cancel" 을 던지지 않고 undefined 를 돌려준다. */
export async function pickPhotoNative(): Promise<File | null | undefined> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const shot = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt, // "사진 찍기 / 앨범에서 선택" 선택지
      quality: 85,
      // 프로필 사진은 카드에 작게 나온다 — 원본 12MP 를 그대로 올릴 이유가 없다
      width: 1440,
      correctOrientation: true,
    });
    if (!shot.webPath) return undefined;

    const blob = await (await fetch(shot.webPath)).blob();
    const ext = (shot.format || "jpg").toLowerCase();
    return new File([blob], `photo.${ext}`, { type: blob.type || `image/${ext}` });
  } catch {
    // 사용자가 취소했거나 권한 거부 — 조용히 접는다
    return undefined;
  }
}

/** 동기 판별 — 클릭 핸들러에서 preventDefault 전에 물어야 해서 async 면 안 된다 */
export const isNativeApp = () => Capacitor.isNativePlatform();
