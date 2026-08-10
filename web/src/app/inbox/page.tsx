"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { careerLabel, level } from "@/lib/levels";
import {
  hasSupabase,
  currentUser,
  fetchMySignups,
  fetchReceivedRequests,
  respondRequest,
  type ReceivedRequest,
} from "@/lib/supabase";

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
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [authed, setAuthed] = useState(true);
  const [received, setReceived] = useState<ReceivedRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    const r = await respondRequest(id, accept);
    setBusy(null);
    if (r.error) return alert(`실패: ${r.error}`);
    setReceived((list) => (list ?? []).filter((x) => x.id !== id));
    if (r.accepted) {
      alert("수락했어요! 채팅으로 이동합니다.");
      router.push("/chat");
    }
  };

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
      setReceived(await fetchReceivedRequests());
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

      {/* 받은 관심 — 수락하면 채팅이 열린다 */}
      {authed && received && received.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-[14px] font-bold">
            💌 받은 관심{" "}
            <span className="font-medium text-accent">{received.length}</span>
          </h2>
          <div className="flex flex-col gap-2">
            {received.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-accent/40 bg-accent/[0.06] p-4"
              >
                <p className="text-[15px] font-extrabold">
                  {r.nickname}
                  <span className="ml-1.5 text-[12px] font-medium text-muted">
                    {[r.age, r.height && `${r.height}cm`, r.area]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {[
                    `L${r.level} ${level(r.level).name}`,
                    careerLabel(r.career) && `구력 ${careerLabel(r.career)}`,
                    r.home_gym,
                    r.mbti,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {r.message && (
                  <p className="mt-2.5 rounded-r-lg border-l-[3px] border-accent bg-surface2 px-3 py-2 text-[13px] leading-relaxed">
                    &ldquo;{r.message}&rdquo;
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, false)}
                    className="rounded-xl border border-line py-2.5 text-[13px] font-bold text-muted disabled:opacity-50"
                  >
                    거절
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, true)}
                    className="rounded-xl bg-accent py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    {busy === r.id ? "처리 중…" : "수락하고 채팅"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">
            거절하면 상대에게 알리지 않아요.
          </p>
        </section>
      )}

      {authed && <h2 className="mb-2 text-[14px] font-bold">🧗 신청한 모임</h2>}

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
