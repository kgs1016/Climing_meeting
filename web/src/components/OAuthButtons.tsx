"use client";

/* 소셜 로그인 버튼 묶음 — 로그인·회원가입 화면이 같은 걸 쓴다.
   대시보드에서 켠 공급자만 노출된다. */

import { useEffect, useState } from "react";
import { enabledOAuthProviders } from "@/lib/supabase";
import { signInWithProvider } from "@/lib/nativeAuth";

const OAUTH = {
  kakao: { label: "카카오로 시작하기", bg: "#FEE500", fg: "#191600", icon: "💬" },
  google: { label: "구글로 시작하기", bg: "#ffffff", fg: "#1f1f1f", icon: "🔵" },
} as const;

type Provider = keyof typeof OAUTH;

export default function OAuthButtons() {
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    enabledOAuthProviders().then((list) =>
      setProviders(list.filter((p): p is Provider => p in OAUTH))
    );
  }, []);

  if (providers.length === 0) return null;

  const oauth = async (provider: Provider) => {
    // 웹은 주소 이동, 앱은 시스템 브라우저 — 갈림은 nativeAuth 가 맡는다
    const { error } = await signInWithProvider(provider);
    if (error) alert(`${OAUTH[provider].label} 실패: ${error}`);
  };

  return (
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
  );
}
