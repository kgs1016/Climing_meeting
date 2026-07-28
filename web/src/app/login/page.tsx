"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] text-ink placeholder:text-muted/60";

export default function Login() {
  const router = useRouter();
  const sb = getSupabase();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "sent">("email");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!sb) {
    return (
      <main className="px-4 pt-16 text-center">
        <p className="text-[15px] font-bold">Supabase 설정이 필요해요</p>
        <p className="mt-2 text-[13px] text-muted">
          web/.env.local 에 프로젝트 키를 넣어주세요 (.env.local.example 참고)
        </p>
      </main>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return alert("이메일을 확인해주세요");
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/me`,
      },
    });
    setBusy(false);
    if (error) {
      return alert(
        error.message.includes("rate")
          ? "메일 발송 한도를 넘었어요. 잠시 후 다시 시도해주세요."
          : `전송 실패: ${error.message}`
      );
    }
    setStep("sent");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) return alert("인증번호가 맞지 않아요. 다시 확인해주세요.");
    router.push("/me");
  };

  return (
    <main className="px-4">
      <header className="pt-10 pb-6 text-center">
        <p className="text-[17px] font-extrabold tracking-[2px] text-accent">
          HOBIDAY
        </p>
        <h1 className="mt-3 text-[21px] font-extrabold tracking-tight">
          {step === "email" ? "이메일로 시작하기" : "메일함을 확인해주세요"}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {step === "email" ? (
            "가입/로그인이 한 번에 돼요. 비밀번호는 없어요."
          ) : (
            <>
              <b className="text-ink">{email}</b> 로 로그인 링크를 보냈어요.
              <br />
              메일 속 링크를 누르면 바로 로그인돼요.
            </>
          )}
        </p>
      </header>

      {step === "email" ? (
        <form onSubmit={send} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
            autoFocus
          />
          <button
            disabled={busy}
            className="rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "전송 중…" : "로그인 링크 받기"}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-surface px-4 py-4 text-center">
            <p className="text-3xl">📬</p>
            <p className="mt-2 text-[13.5px] font-semibold">
              메일이 안 보이면 스팸함도 확인해주세요
            </p>
          </div>

          {/* 커스텀 SMTP 연결 후 인증번호 방식으로 전환 가능 */}
          {showCode ? (
            <form onSubmit={verify} className="flex flex-col gap-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className={`${inputCls} text-center text-[20px] font-bold tracking-[6px]`}
                autoFocus
              />
              <button
                disabled={busy || code.length < 6}
                className="rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
              >
                {busy ? "확인 중…" : "인증번호로 로그인"}
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowCode(true)}
              className="py-2 text-[13px] font-semibold text-muted underline underline-offset-4"
            >
              메일에 인증번호가 왔다면 직접 입력하기
            </button>
          )}

          <button
            onClick={() => setStep("email")}
            className="py-2 text-[13px] font-semibold text-muted"
          >
            이메일 다시 입력
          </button>
        </div>
      )}
    </main>
  );
}
