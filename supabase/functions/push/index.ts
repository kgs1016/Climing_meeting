/* 푸시 발송 — 앱이 "이 사람에게 알림 보내줘" 라고 부르는 서버.
 *
 *  왜 서버가 따로 필요한가: 발송 비밀키(FCM 서비스 계정, APNs .p8)를 앱에
 *  넣으면 누구나 꺼내서 아무에게나 알림을 쏠 수 있다. 키는 여기에만 둔다.
 *
 *  플랫폼별로 경로가 다르다:
 *    android → FCM (Firebase)
 *    ios     → APNs 직접 (Firebase 안 거침 — iOS 앱에 Firebase SDK 를
 *              심지 않아도 되고, 네이티브 코드 수정이 0 이 된다)
 *
 *  흐름:
 *    앱 (JWT 포함) → 이 함수
 *      → can_notify() 로 관계 검사 (매칭·관심·같은 모임만 허용, 차단 거부)
 *      → push_tokens 에서 상대 기기 토큰 조회
 *      → 플랫폼별 발송, 죽은 토큰은 그 자리에서 정리
 *
 *  필요한 secret (supabase secrets set):
 *    FIREBASE_SERVICE_ACCOUNT  Firebase > 프로젝트 설정 > 서비스 계정 JSON (android)
 *    APNS_KEY                  애플 .p8 파일 내용 통째로            (ios)
 *    APNS_KEY_ID               키 발급 화면의 Key ID (10자리)        (ios)
 *    APPLE_TEAM_ID             개발자 계정 Team ID                  (ios)
 *  없는 쪽은 조용히 건너뛴다 (앱 동작을 막지 않는다).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5";

const APNS_TOPIC = "kr.hobiday.app"; // 번들 ID 와 같아야 한다

type Body = {
  to: string[]; // 받는 사람 user id (최대 8명 — 모임 채팅용)
  title: string;
  body: string;
  url?: string; // 탭하면 열 앱 내 경로 (예: /chat)
};

/* ── FCM (android) ── */

let fcmCached: { value: string; exp: number } | null = null;

async function fcmAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (fcmCached && fcmCached.exp > now + 60) return fcmCached.value;

  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`fcm token exchange failed: ${JSON.stringify(j)}`);
  fcmCached = { value: j.access_token, exp: now + 3500 };
  return j.access_token;
}

/** 성공 true · 죽은 토큰 "dead" · 그 외 실패 false */
async function sendFcm(
  sa: { project_id: string; client_email: string; private_key: string },
  token: string,
  title: string,
  body: string,
  url: string
): Promise<true | false | "dead"> {
  const access = await fcmAccessToken(sa);
  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: { url },
          android: { priority: "high" },
        },
      }),
    }
  );
  if (r.ok) return true;
  if (r.status === 404 || r.status === 400) return "dead";
  return false;
}

/* ── APNs (ios) ── */

let apnsCached: { value: string; exp: number } | null = null;

async function apnsJwt(p8: string, keyId: string, teamId: string) {
  const now = Math.floor(Date.now() / 1000);
  // 애플은 20~60분짜리 토큰을 요구한다 — 40분마다 갱신
  if (apnsCached && apnsCached.exp > now + 60) return apnsCached.value;

  const key = await importPKCS8(p8, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(key);
  apnsCached = { value: jwt, exp: now + 2400 };
  return jwt;
}

async function apnsPost(host: string, jwt: string, token: string, payload: unknown) {
  return fetch(`${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify(payload),
  });
}

async function sendApns(
  p8: string,
  keyId: string,
  teamId: string,
  token: string,
  title: string,
  body: string,
  url: string
): Promise<true | false | "dead"> {
  const jwt = await apnsJwt(p8, keyId, teamId);
  const payload = { aps: { alert: { title, body }, sound: "default" }, url };

  let r = await apnsPost("https://api.push.apple.com", jwt, token, payload);
  if (r.status === 400) {
    // 개발용 빌드(Xcode 직접 설치)는 sandbox 토큰이라 운영 서버가 거부한다
    const reason = (await r.json().catch(() => ({})))?.reason;
    if (reason === "BadDeviceToken") {
      r = await apnsPost("https://api.sandbox.push.apple.com", jwt, token, payload);
    }
  }
  if (r.ok) return true;
  if (r.status === 410) return "dead"; // 앱 삭제됨
  return false;
}

/* ── 본체 ── */

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  // 호출자 확인 — verify_jwt 로 서명은 이미 검증됐고, 여기서 uid 를 꺼낸다
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
  const { data: userData } = await supa.auth.getUser();
  const me = userData?.user?.id;
  if (!me) return Response.json({ error: "no_auth" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const to = [...new Set(body.to ?? [])].filter((x) => x && x !== me).slice(0, 8);
  const title = (body.title ?? "").slice(0, 80);
  const text = (body.body ?? "").slice(0, 200);
  const url = body.url && body.url.startsWith("/") ? body.url : "/";
  if (!to.length || !title) return Response.json({ error: "bad_input" }, { status: 400 });

  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  const sa = saRaw ? JSON.parse(saRaw) : null;
  const apnsKey = Deno.env.get("APNS_KEY");
  const apnsKeyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const apnsReady = !!(apnsKey && apnsKeyId && teamId);
  if (!sa && !apnsReady) {
    // 아무 발송 경로도 설정 전 — 알림은 부가 기능이라 앱을 막지 않는다
    return Response.json({ ok: true, sent: 0, reason: "not_configured" });
  }

  // 관계 검사·토큰 조회는 service role 로 (RLS 밖 — 남의 토큰을 읽어야 한다)
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const allowed: string[] = [];
  for (const target of to) {
    const { data: ok } = await admin.rpc("can_notify", { p_from: me, p_to: target });
    if (ok === true) allowed.push(target);
  }
  if (!allowed.length) return Response.json({ ok: true, sent: 0 });

  const { data: tokens } = await admin
    .from("push_tokens")
    .select("token, platform")
    .in("user_id", allowed);
  if (!tokens?.length) return Response.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const { token, platform } of tokens) {
    let result: true | false | "dead" = false;
    try {
      if (platform === "android" && sa) {
        result = await sendFcm(sa, token, title, text, url);
      } else if (platform === "ios" && apnsReady) {
        result = await sendApns(apnsKey!, apnsKeyId!, teamId!, token, title, text, url);
      } else {
        continue; // 이 플랫폼의 발송 경로가 아직 미설정
      }
    } catch {
      result = false;
    }
    if (result === true) sent++;
    // 죽은 토큰(앱 삭제 등)은 쌓아두면 매번 실패만 반복한다
    else if (result === "dead") await admin.from("push_tokens").delete().eq("token", token);
  }

  return Response.json({ ok: true, sent });
});
