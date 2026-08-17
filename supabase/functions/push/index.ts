/* 푸시 발송 — 앱이 "이 사람에게 알림 보내줘" 라고 부르는 서버.
 *
 *  왜 서버가 따로 필요한가: FCM(구글 발송 서버)을 부르려면 Firebase 의
 *  서비스 계정 비밀키가 필요하다. 이걸 앱에 넣으면 누구나 꺼내서 아무에게나
 *  알림을 쏠 수 있다. 그래서 키는 여기(서버)에만 두고, 앱은 요청만 한다.
 *
 *  흐름:
 *    앱 (JWT 포함) → 이 함수
 *      → can_notify() 로 관계 검사 (매칭·관심·같은 모임만 허용, 차단 거부)
 *      → push_tokens 에서 상대 기기 토큰 조회
 *      → FCM v1 로 발송, 죽은 토큰은 그 자리에서 정리
 *
 *  필요한 secret (supabase secrets set 으로 등록):
 *    FIREBASE_SERVICE_ACCOUNT  Firebase 콘솔 > 프로젝트 설정 > 서비스 계정
 *                              > 새 비공개 키 생성 — 그 JSON 파일 내용 통째로
 *  secret 이 없으면 조용히 no-op 한다 (앱 동작을 막지 않는다).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5";

type Body = {
  to: string[]; // 받는 사람 user id (최대 8명 — 모임 채팅용)
  title: string;
  body: string;
  url?: string; // 탭하면 열 앱 내 경로 (예: /chat)
};

/** FCM v1 은 OAuth 토큰을 요구한다. 서비스 계정 키로 JWT 를 만들어 교환한다.
 *  토큰은 1시간 유효 — 함수 인스턴스가 살아 있는 동안 재사용한다. */
let cachedToken: { value: string; exp: number } | null = null;

async function fcmAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.value;

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
  if (!j.access_token) throw new Error(`token exchange failed: ${JSON.stringify(j)}`);
  cachedToken = { value: j.access_token, exp: now + 3500 };
  return j.access_token;
}

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
  if (!to.length || !title) return Response.json({ error: "bad_input" }, { status: 400 });

  // Firebase 미설정이면 조용히 통과 — 알림은 부가 기능이라 앱을 막지 않는다
  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!saRaw) return Response.json({ ok: true, sent: 0, reason: "not_configured" });
  const sa = JSON.parse(saRaw);

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
    .select("token")
    .in("user_id", allowed);
  if (!tokens?.length) return Response.json({ ok: true, sent: 0 });

  const access = await fcmAccessToken(sa);
  let sent = 0;
  for (const { token } of tokens) {
    const r = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: text },
            data: { url: body.url ?? "/" },
            apns: { payload: { aps: { sound: "default" } } },
            android: { priority: "high" },
          },
        }),
      }
    );
    if (r.ok) {
      sent++;
    } else if (r.status === 404 || r.status === 400) {
      // 앱 삭제 등으로 죽은 토큰 — 쌓아두면 매번 실패만 반복한다
      await admin.from("push_tokens").delete().eq("token", token);
    }
  }

  return Response.json({ ok: true, sent });
});
