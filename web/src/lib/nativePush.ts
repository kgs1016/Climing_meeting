"use client";

/* 네이티브 푸시 알림 — 토큰 등록과 알림 탭 처리.
 *
 *  앱은 세 가지만 한다:
 *   1. 로그인된 상태로 앱을 열면 OS 에 권한을 묻고 기기 토큰을 받아 저장
 *   2. 알림을 탭하면 data.url 로 이동
 *   3. 로그아웃하면 토큰 삭제 (안 지우면 이 폰에 알림이 계속 온다)
 *
 *  발송은 Edge Function(push)이 한다 — notifyPush() 로 부탁만 한다.
 *  웹(PWA)에서는 전부 no-op. 웹 푸시는 별도 작업(VAPID)이라 나중에.
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getSupabase } from "./supabase";

const TOKEN_KEY = "hobiday.push.token"; // 로그아웃 때 지우려고 기억해둔다

export const isNativePush = () => Capacitor.isNativePlatform();

/** 로그인 후 한 번 부른다. 거부하면 조용히 접는다 — 알림은 부가 기능이다. */
export async function registerPush(): Promise<void> {
  if (!isNativePush()) return;

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "denied") return;
  if (perm.receive !== "granted") {
    const asked = await PushNotifications.requestPermissions();
    if (asked.receive !== "granted") return;
  }

  // 리스너를 register() 보다 먼저 걸어야 첫 토큰을 놓치지 않는다
  await PushNotifications.addListener("registration", async ({ value }) => {
    const sb = getSupabase();
    if (!sb || !value) return;
    localStorage.setItem(TOKEN_KEY, value);
    await sb.rpc("push_token_save", {
      p_token: value,
      p_platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
    });
  });

  await PushNotifications.register();
}

/** 알림을 탭했을 때 — data.url 로 이동. 반환값은 정리 함수. */
export function onPushTap(navigate: (url: string) => void): () => void {
  if (!isNativePush()) return () => {};

  const sub = PushNotifications.addListener(
    "pushNotificationActionPerformed",
    ({ notification }) => {
      const url = notification.data?.url;
      if (typeof url === "string" && url.startsWith("/")) navigate(url);
    }
  );
  return () => {
    sub.then((s) => s.remove()).catch(() => {});
  };
}

/** 로그아웃 직전에 부른다 — 세션이 살아 있어야 RPC 가 통과한다 */
export async function unregisterPush(): Promise<void> {
  if (!isNativePush()) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  localStorage.removeItem(TOKEN_KEY);
  await getSupabase()?.rpc("push_token_delete", { p_token: token });
}

/** 상대에게 알림을 보내달라고 서버에 부탁한다.
 *  실패해도 조용히 넘어간다 — 메시지 전송 자체를 막으면 안 된다. */
export async function notifyPush(
  to: string | string[],
  title: string,
  body: string,
  url?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.functions.invoke("push", {
      body: { to: Array.isArray(to) ? to : [to], title, body, url },
    });
  } catch {
    /* 알림 실패는 본 동작에 영향 없음 */
  }
}
