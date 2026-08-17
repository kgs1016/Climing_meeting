"use client";

/* 네이티브 앱에서의 사진 선택.
 *
 *  웹뷰의 <input type="file"> 도 모바일에서는 카메라를 열 수 있지만,
 *  네이티브 플러그인을 쓰면 "찍기 / 앨범" 선택지가 OS 표준 UI 로 뜨고
 *  권한 요청도 앱 이름으로 나간다. 심사(4.2 최소 기능) 관점에서도
 *  네이티브 API 를 실제로 쓰는 근거가 된다.
 *
 *  웹에서는 null 을 돌려줘서 기존 파일 선택창으로 폴백한다.
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
