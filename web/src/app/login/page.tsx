"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, enabledOAuthProviders } from "@/lib/supabase";

const inputCls =
  // iOS 는 16px 미만 입력창에 포커스하면 화면을 강제로 확대한다 — 16px 유지
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-muted/60";

const OAUTH = {
  kakao: { label: "카카오로 시작하기", bg: "#FEE500", fg: "#191600", icon: "💬" },
  google: { label: "구글로 시작하기", bg: "#ffffff", fg: "#1f1f1f", icon: "🔵" },
} as const;

type Provider = keyof typeof OAUTH;

export default function Login() {
  const router = useRouter();
  const sb = getSupabase();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sentMail, setSentMail] = useState(false);

  useEffect(() => {
    // 소개 페이지의 "지금 사전 가입하기" 는 ?mode=signup 으로 보낸다.
    // useSearchParams 를 쓰면 이 페이지가 Suspense 를 요구해서 window 로 읽는다.
    if (new URLSearchParams(window.location.search).get("mode") === "signup") {
      setMode("signup");
    }
    enabledOAuthProviders().then((list) =>
      setProviders(list.filter((p): p is Provider => p in OAUTH))
    );
  }, []);

  if (!sb) {
    return (
      <main className="px-4 pt-16 text-center">
        <p className="text-[15px] font-bold">Supabase 설정이 필요해요</p>
        <p className="mt-2 text-[13px] text-muted">
          web/.env.local 에 프로젝트 키를 넣어주세요
        </p>
      </main>
    );
  }

  const oauth = async (provider: Provider) => {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) alert(`${OAUTH[provider].label} 실패: ${error.message}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return alert("이메일을 확인해주세요");
    if (pw.length < 6) return alert("비밀번호는 6자 이상으로 해주세요");

    setBusy(true);
    if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password: pw,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setBusy(false);
      if (error) {
        return alert(
          error.message.includes("already registered")
            ? "이미 가입된 이메일이에요. 로그인해주세요."
            : `가입 실패: ${error.message}`
        );
      }
      // 이메일 확인이 켜져 있으면 세션 없이 확인 메일이 발송됨
      if (!data.session) {
        setSentMail(true);
        return;
      }
      router.push("/profile/new");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      setBusy(false);
      if (error) {
        return alert(
          error.message.includes("Email not confirmed")
            ? "메일에서 이메일 인증을 먼저 완료해주세요."
            : "이메일 또는 비밀번호가 맞지 않아요."
        );
      }
      router.push("/me");
    }
  };

  if (sentMail) {
    return (
      <main className="px-4 pt-16 text-center">
        <p className="text-4xl">📬</p>
        <h1 className="mt-3 text-[20px] font-extrabold">이메일 인증이 필요해요</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          <b className="text-ink">{email}</b> 로 인증 메일을 보냈어요.
          <br />
          링크를 누르면 가입이 완료돼요.
        </p>
        <button
          onClick={() => {
            setSentMail(false);
            setMode("login");
          }}
          className="mt-6 text-[13px] font-semibold text-muted underline underline-offset-4"
        >
          로그인으로 돌아가기
        </button>
      </main>
    );
  }

  return (
    <main className="px-4">
      <header className="pt-10 pb-6 text-center">
        <p className="text-[17px] font-extrabold tracking-[2px] text-accent">
          HOBIDAY
        </p>
        <h1 className="mt-3 text-[21px] font-extrabold tracking-tight">
          {mode === "login" ? "로그인" : "회원가입"}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          취미로 시작해서, 사람으로 끝나는 하루
        </p>
      </header>

      {/* 소셜 로그인 — 대시보드에서 켠 것만 노출 */}
      {providers.length > 0 && (
        <div className="mb-5 flex flex-col gap-2">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => oauth(p)}
              style={{ background: OAUTH[p].bg, color: OAUTH[p].fg }}
              className="flex items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-bold"
            >
              <span>{OAUTH[p].icon}</span>
              {OAUTH[p].label}
            </button>
          ))}
          <div className="my-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[12px] text-muted">또는 이메일로</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          autoComplete="email"
          className={inputCls}
        />
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호 (6자 이상)"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className={inputCls}
        />
        <button
          disabled={busy}
          className="mt-1 rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-5 w-full text-center text-[13px] font-semibold text-muted"
      >
        {mode === "login" ? (
          <>
            계정이 없으신가요? <span className="text-accent">회원가입</span>
          </>
        ) : (
          <>
            이미 계정이 있으신가요? <span className="text-accent">로그인</span>
          </>
        )}
      </button>
    </main>
  );
}
