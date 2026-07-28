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
  const [step, setStep] = useState<"email" | "code">("email");
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

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return alert("이메일을 확인해주세요");
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return alert(`전송 실패: ${error.message}`);
    setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return alert("인증번호가 맞지 않아요. 다시 확인해주세요.");
    router.push("/me");
  };

  return (
    <main className="px-4">
      <header className="pt-10 pb-6 text-center">
        <p className="text-[17px] font-extrabold tracking-[2px] text-accent">HOBIDAY</p>
        <h1 className="mt-3 text-[21px] font-extrabold tracking-tight">
          {step === "email" ? "이메일로 시작하기" : "인증번호 입력"}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          {step === "email"
            ? "가입/로그인이 한 번에 돼요. 비밀번호는 없어요."
            : `${email} 로 메일을 보냈어요`}
        </p>
        {step === "code" && (
          <p className="mt-1 text-[12px] text-muted">
            6자리 번호를 입력하거나, 메일 속 링크를 눌러도 돼요
          </p>
        )}
      </header>

      {step === "email" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
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
            {busy ? "전송 중…" : "인증번호 받기"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            className={`${inputCls} text-center tracking-[6px] text-[20px] font-bold`}
            autoFocus
          />
          <button
            disabled={busy || code.length < 6}
            className="rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "확인 중…" : "로그인"}
          </button>
          <button
            type="button"
            onClick={() => setStep("email")}
            className="py-2 text-[13px] font-semibold text-muted"
          >
            이메일 다시 입력
          </button>
        </form>
      )}
    </main>
  );
}
