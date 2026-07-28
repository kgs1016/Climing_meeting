"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { hasSupabase, currentUser, fetchMySignups } from "@/lib/supabase";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface Row {
  id: string;
  title: string;
  status: "waiting" | "confirmed" | "cut";
}

const STATUS = {
  waiting: { label: "대기 중", cls: "bg-surface2 text-muted" },
  confirmed: { label: "확정", cls: "bg-mint/15 text-mint" },
  cut: { label: "다음 순번 · 우선권 보유", cls: "bg-accent/15 text-accent-soft" },
};

const MOCK: Row[] = [
  { id: "s1", title: "더클라임 B홍대 · 토 8/1 15:00", status: "confirmed" },
  { id: "s3", title: "홍대클라이밍 · 토 8/1 19:00", status: "cut" },
];

export default function Inbox() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    (async () => {
      if (!hasSupabase()) {
        setRows(MOCK);
        return;
      }
      const user = await currentUser();
      if (!user) {
        setAuthed(false);
        setRows([]);
        return;
      }
      const data = await fetchMySignups();
      setRows(
        (data ?? []).map((d) => {
          const st = new Date(d.starts_at);
          return {
            id: d.id,
            title: `${d.gym} · ${DAYS[st.getDay()]} ${st.getMonth() + 1}/${st.getDate()} ${String(
              st.getHours()
            ).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}`,
            status: (d.my_status ?? "waiting") as Row["status"],
          };
        })
      );
    })();
  }, []);

  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">신청함</h1>
      </header>

      {!authed ? (
        <div className="mt-14 flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-muted">로그인하면 신청 내역이 보여요</p>
          <Link
            href="/login"
            className="rounded-xl bg-accent px-6 py-2.5 text-[14px] font-bold text-white"
          >
            로그인 하기
          </Link>
        </div>
      ) : rows === null ? (
        <p className="pt-14 text-center text-muted">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <div className="mt-14 text-center">
          <p className="text-3xl">📥</p>
          <p className="mt-2 text-[14px] font-bold">아직 신청한 모임이 없어요</p>
          <Link
            href="/"
            className="mt-1 inline-block text-[13px] font-bold text-accent"
          >
            모임 둘러보기 →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <Link
              key={a.id}
              href={`/session/${a.id}`}
              className="block rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-bold">{a.title}</p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS[a.status].cls}`}
                >
                  {STATUS[a.status].label}
                </span>
              </div>
              {a.status === "cut" && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  이번 모임은 성비 조정으로 다음 순번이 됐어요. 다음 모임 신청 시{" "}
                  <b className="text-ink">우선 확정</b>됩니다.
                </p>
              )}
              {a.status === "waiting" && (
                <p className="mt-2 text-[12.5px] text-muted">
                  자리가 나면 자동으로 확정돼요.
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
