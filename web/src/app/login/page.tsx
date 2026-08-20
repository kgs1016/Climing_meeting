"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, enabledOAuthProviders } from "@/lib/supabase";
import { signInWithProvider } from "@/lib/nativeAuth";

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
  const [otp, setOtp] = useState(""); // 가입 확인 인증번호 (메일의 6자리)
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
    // 웹은 주소 이동, 앱은 시스템 브라우저 — 갈림은 nativeAuth 가 맡는다
    const { error } = await signInWithProvider(provider);
    if (error) alert(`${OAUTH[provider].label} 실패: ${error}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return alert("이메일을 확인해주세요");
    if (pw.length < 6) return alert("비밀번호는 6자 이상으로 해주세요");

    setBusy(true);
    if (mode === "signup") {
      // 링크 대신 인증번호로 확인한다 — 메일 템플릿이 {{ .Token }} 을 보여주고,
      // 사용자는 이 화면에 남아 번호만 입력한다. 메일 앱으로 넘어갔다가
      // 낯선 브라우저에서 이어지는 흐름보다 끊김이 없고, 네이티브 앱에서는
      // 링크가 앱 밖으로 나가버려서 사실상 이 방식만 성립한다.
      const { data, error } = await sb.auth.signUp({ email, password: pw });
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

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = otp.trim();
    // 자릿수는 프로젝트 설정(Email OTP Length)을 따른다 — 범위로 받아
    // 설정이 바뀌어도 화면이 깨지지 않게 한다
    if (!/^\d{6,8}$/.test(token)) return alert("메일의 인증번호를 입력해주세요");

    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email, token, type: "signup" });
    setBusy(false);
    if (error) {
      return alert(
        error.message.includes("expired")
          ? "인증번호가 만료됐어요. 다시 받아주세요."
          : "인증번호가 맞지 않아요. 메일을 다시 확인해주세요."
      );
    }
    // 인증과 동시에 로그인된다
    router.push("/profile/new");
  };

  const resendCode = async () => {
    setBusy(true);
    const { error } = await sb.auth.resend({ type: "signup", email });
    setBusy(false);
    if (error) {
      // SMTP 의 사용자당 최소 간격(20초)에 걸리면 여기로 온다
      return alert("잠시 후 다시 시도해주세요.");
    }
    alert("인증번호를 다시 보냈어요.");
  };

  if (sentMail) {
    return (
      <main className="px-4 pt-16 text-center">
        <p className="text-4xl">📬</p>
        <h1 className="mt-3 text-[20px] font-extrabold">인증번호를 보냈어요</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          <b className="text-ink">{email}</b> 메일함을 확인해주세요.
          <br />
          메일에 적힌 6자리 번호를 입력하면 가입이 완료돼요.
        </p>
        <form onSubmit={verifyCode} className="mx-auto mt-6 max-w-[280px]">
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            // 숫자뿐이라 크게 — iOS 확대(16px 미만) 걱정도 없다
            className="w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-center text-[22px] font-extrabold tracking-[0.3em] text-ink placeholder:text-muted/40"
          />
          <button
            type="submit"
            disabled={busy || otp.length < 6}
            className="mt-3 w-full rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-40"
          >
            {busy ? "확인 중…" : "인증하고 가입 완료"}
          </button>
        </form>
        <button
          onClick={resendCode}
          disabled={busy}
          className="mt-5 text-[13px] font-semibold text-muted underline underline-offset-4 disabled:opacity-50"
        >
          인증번호 다시 받기
        </button>
        <br />
        <button
          onClick={() => {
            setSentMail(false);
            setOtp("");
            setMode("login");
          }}
          className="mt-3 text-[13px] font-semibold text-muted/70"
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

      {/* 애플 심사 1.2 — UGC 앱은 약관 동의가 가입 흐름에 보여야 한다.
          소셜·이메일 어느 쪽으로 가입하든 이 화면을 지나므로 여기 둔다. */}
      <p className="mt-4 text-center text-[11.5px] leading-relaxed text-muted/80">
        가입하면 하비데이의{" "}
        <a href="/terms" className="underline underline-offset-2 text-muted">
          이용약관
        </a>
        과{" "}
        <a href="/privacy" className="underline underline-offset-2 text-muted">
          개인정보처리방침
        </a>
        에 동의하는 것으로 봅니다.
      </p>

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
