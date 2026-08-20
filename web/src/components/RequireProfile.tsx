"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isProfileComplete } from "@/lib/profileGate";
import { missingFields } from "@/lib/profileGate";
import { currentUser, fetchMyProfileDb, hasSupabase } from "@/lib/supabase";

/* 프로필을 완성해야 앱을 쓸 수 있다.
   서로 얼굴과 실력을 아는 사람끼리 만나는 게 이 앱의 전제라, 프로필이 없는
   사람이 목록을 둘러보는 상태 자체가 없어야 한다.

   화면마다 따로 막으면 하나 빠뜨렸을 때 그 길로 다 들어온다. 레이아웃에서
   한 번에 막는다. */

// 프로필을 만들러 가는 길과 로그인·가입은 막으면 안 된다
const OPEN_PATHS = ["/login", "/signup", "/profile/new", "/auth/callback"];

/* 한 번 완성한 사람에게 화면을 옮길 때마다 다시 묻지 않는다.
   완성 전(false)은 캐시하지 않는다 — 방금 채웠을 수 있다. */
let completeOnce = false;

export default function RequireProfile({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const open = OPEN_PATHS.some((p) => pathname.startsWith(p));

  // null = 확인 중. 깜빡임을 막으려고 이때는 아무것도 그리지 않는다.
  const [ok, setOk] = useState<boolean | null>(
    !hasSupabase() || open || completeOnce ? true : null
  );
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    if (!hasSupabase() || open || completeOnce) {
      setOk(true);
      return;
    }
    let alive = true;
    (async () => {
      const user = await currentUser();
      // 비로그인은 각 화면이 알아서 로그인 안내를 띄운다
      if (!user) {
        if (alive) setOk(true);
        return;
      }
      const p = await fetchMyProfileDb();
      if (!alive) return;
      if (isProfileComplete(p)) {
        completeOnce = true;
        setOk(true);
      } else {
        setMissing(p ? missingFields(p) : []);
        setOk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pathname, open]);

  if (ok === null) return null;
  if (ok) return <>{children}</>;

  return (
    <main className="px-4">
      <header className="pt-16 text-center">
        <p className="text-4xl">🧗</p>
        <h1 className="mt-4 text-[20px] font-extrabold leading-snug tracking-tight">
          프로필을 완성해야
          <br />
          이용할 수 있어요
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
          서로 얼굴과 실력을 아는 사람들끼리 만나는 게
          <br />이 앱의 전부예요. 모두가 같은 조건이에요.
        </p>
      </header>

      {missing.length > 0 && (
        <section className="mx-auto mt-7 max-w-sm rounded-2xl border border-line bg-surface px-5 py-4">
          <p className="text-[12.5px] font-semibold text-muted">아직 빠진 것</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {missing.map((m) => (
              <li key={m} className="text-[14px] font-bold">
                · {m}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mx-auto mt-5 max-w-sm">
        <Link
          href="/profile/new"
          className="block rounded-xl bg-accent py-3.5 text-center text-[15px] font-bold text-white"
        >
          프로필 완성하러 가기
        </Link>
      </div>

      <p className="mt-5 text-center text-[11.5px] leading-relaxed text-muted">
        1분이면 끝나요. 완성하면 크레딧도 받아요.
      </p>
    </main>
  );
}
