"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetchInboxCounts } from "@/lib/supabase";

const TABS = [
  { href: "/", label: "홈", icon: "🏠" },
  { href: "/chat", label: "채팅", icon: "💬" },
  { href: "/inbox", label: "신청함", icon: "📥" },
  { href: "/me", label: "내 정보", icon: "🧗" },
];

export default function BottomNav() {
  const pathname = usePathname();
  // 받은 관심 뱃지 — 알림이 없으면 관심을 보내도 상대가 모른다
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const c = await fetchInboxCounts();
      if (alive && c) setPending(c.requests);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // 화면을 옮길 때마다 갱신해 수락 직후 뱃지가 남지 않게
  }, [pathname]);

  return (
    // pb-[safe] — 홈 화면에 추가해 전체화면으로 뜰 때 아이폰 홈바에 가리지 않게
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-md grid grid-cols-4">
        {TABS.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className="relative text-lg leading-none">
                {t.icon}
                {t.href === "/inbox" && pending > 0 && (
                  <span className="absolute -right-2.5 -top-1 min-w-[16px] rounded-full bg-accent px-1 text-[10px] font-extrabold leading-[16px] text-white">
                    {pending > 9 ? "9+" : pending}
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
