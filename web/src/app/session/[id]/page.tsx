"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { level, levelRangeLabel } from "@/lib/levels";
import { isProfileComplete } from "@/lib/profileGate";
import { MOCK_SESSIONS, slotsLeft, type Session } from "@/lib/mock";
import {
  hasSupabase,
  currentUser,
  fetchSessions,
  fetchMyProfileDb,
  joinSession,
  signedPhotoUrls,
  toSession,
} from "@/lib/supabase";

type S = Session & { myStatus?: string | null };

export default function SessionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [s, setS] = useState<S | null | undefined>(undefined);
  const [hostPhoto, setHostPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!hasSupabase()) {
      setS(MOCK_SESSIONS.find((x) => x.id === id) ?? null);
      return;
    }
    const rows = await fetchSessions();
    const row = rows?.find((r) => r.id === id);
    setS(row ? toSession(row) : null);
    if (row?.host_photo) {
      setHostPhoto((await signedPhotoUrls([row.host_photo]))[row.host_photo] ?? null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (s === undefined)
    return <main className="px-4 pt-20 text-center text-muted">불러오는 중…</main>;
  if (s === null)
    return (
      <main className="px-4 pt-20 text-center text-muted">
        모임을 찾을 수 없어요
      </main>
    );

  const left = slotsLeft(s);
  const full = left.male <= 0 && left.female <= 0;
  const joined = s.myStatus === "confirmed" || s.myStatus === "waiting";

  const badges = [
    ...Array.from({ length: s.maleJoined }, (_, i) => ({ g: "m", key: `m${i}` })),
    ...Array.from({ length: s.femaleJoined }, (_, i) => ({ g: "f", key: `f${i}` })),
  ];

  const onJoin = async () => {
    if (!hasSupabase()) {
      alert(
        full
          ? "대기 신청했어요. 자리가 나면 순서대로 알려드릴게요. (목데이터 단계)"
          : "모임 신청 완료! 성비가 맞으면 확정 알림을 보내드려요. (목데이터 단계)"
      );
      return;
    }
    setBusy(true);
    const user = await currentUser();
    if (!user) {
      setBusy(false);
      alert("신청하려면 로그인이 필요해요");
      router.push("/login");
      return;
    }
    const profile = await fetchMyProfileDb();
    if (!isProfileComplete(profile)) {
      setBusy(false);
      alert(
        profile
          ? "프로필을 먼저 완성해주세요 (대표 사진·구력)"
          : "먼저 프로필을 만들어주세요 (성비 매칭의 기본 정보예요)"
      );
      router.push("/profile/new");
      return;
    }
    const r = await joinSession(s.id);
    setBusy(false);
    if (r.error === "is_host") return alert("내가 연 모임이에요!");
    if (r.error) return alert(`신청 실패: ${r.error}`);
    alert(
      r.status !== "confirmed"
        ? "대기 신청됐어요. 자리가 나면 자동으로 확정돼요."
        : r.chat_opened
          ? "정원이 다 찼어요! 모임 채팅방이 열렸습니다 🎉\n채팅 → 모임 채팅에서 만나요."
          : "확정됐어요! 모임에서 만나요 🧗"
    );
    load();
  };

  return (
    <main className="px-4">
      <header className="flex items-center gap-3 pt-5 pb-4">
        <button onClick={() => router.back()} className="text-lg text-muted">
          ←
        </button>
        <h1 className="text-[19px] font-extrabold tracking-tight">모임 정보</h1>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-[18px] font-extrabold tracking-tight">
          {s.gym}
          {s.isAway && (
            <span className="ml-2 text-[12px] font-bold text-mint">🗺 원정</span>
          )}
        </p>
        <p className="mt-1 text-[13.5px] text-muted">
          {s.date} · {s.start}~{s.end}
        </p>
        <div className="mt-3 flex flex-col gap-1 text-[13.5px]">
          <p>{levelRangeLabel(s.levelMin, s.levelMax)}</p>
          <p className="text-muted">
            {s.intensity === "chill" ? "😌 가볍게" : "🔥 빡세게"}
            {s.afterMeal && " · 🍽 저녁까지 시간 돼요"}
          </p>
          {s.note && <p className="mt-1 text-ink/90">&ldquo;{s.note}&rdquo;</p>}
        </div>
      </section>

      {/* 참가 현황 — 익명 */}
      <section className="mt-4">
        <h2 className="mb-2 text-[14px] font-bold">
          참가 현황{" "}
          <span className="font-medium text-muted">
            ({s.maleJoined + s.femaleJoined}/{s.capacity * 2})
          </span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span
              key={b.key}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
                b.g === "m" ? "bg-male/15 text-male" : "bg-female/15 text-female"
              }`}
            >
              {b.g === "m" ? "남" : "여"} 확정
            </span>
          ))}
          {Array.from({ length: Math.max(0, left.male) }, (_, i) => (
            <span
              key={`em${i}`}
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              남 모집중
            </span>
          ))}
          {Array.from({ length: Math.max(0, left.female) }, (_, i) => (
            <span
              key={`ef${i}`}
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              여 모집중
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          다른 참가자는 <b className="text-ink">확정되면</b> 서로 프로필을 볼 수
          있어요. 모임을 연 호스트는 아래에서 지금 볼 수 있어요.
        </p>
      </section>

      {/* 호스트 — 눌러서 프로필 전체 보기 */}
      {s.host && (
        <section className="mt-4">
          <h2 className="mb-2 text-[14px] font-bold">호스트 정보</h2>
          <Link
            href={`/session/${s.id}/host`}
            className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 active:scale-[0.99] transition-transform"
          >
            {hostPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hostPhoto}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface2 text-xl">
                🧗
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-extrabold">
                {s.host.nickname}
                {s.host.age && (
                  <span className="ml-1.5 text-[12.5px] font-medium text-muted">
                    {s.host.age}
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">
                {[
                  s.host.area,
                  s.host.level && `L${s.host.level} ${level(s.host.level).name}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <span className="shrink-0 text-muted">›</span>
          </Link>
        </section>
      )}

      {/* 영상 인증 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[14px] font-bold">🎥 등반 인증</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          모임에서 등반한 영상을 자유롭게 올리면 크레딧이 쌓여요. 서로 찍어주면
          되고, <b className="text-ink">완등 못 해도 괜찮아요.</b> 영상은 나만 볼 수
          있고 내 보관함에 남아요.
        </p>
      </section>

      {/* 안내 */}
      <section className="mt-4 flex flex-col gap-2 text-[12.5px] leading-relaxed text-muted">
        <p>💰 일일권+신발 대여 3만원 내외 · 현장 각자 결제</p>
        <p>👟 준비물: 운동복, 양말, 물 (신발은 대여 가능)</p>
        <p>✂️ 손톱은 짧게, 반지는 빼고 와주세요</p>
      </section>

      {s.myStatus === "confirmed" && (
        <div className="mt-5 flex flex-col gap-2">
          {/* 정원이 다 차면 참가자 전원이 한 방에 모인다 */}
          {full && (
            <Link
              href="/chat#session"
              className="block rounded-xl border border-mint/50 bg-mint/10 py-3.5 text-center text-[14.5px] font-bold text-mint"
            >
              💬 모임 채팅 열기
            </Link>
          )}
          <Link
            href={`/room/${s.id}`}
            className="block rounded-xl border border-accent/50 bg-accent/10 py-3.5 text-center text-[14.5px] font-bold text-accent"
          >
            🧗 모임 진행 화면 열기
          </Link>
        </div>
      )}

      <button
        disabled={busy || joined}
        className={`mt-6 mb-8 w-full rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-70 ${
          joined
            ? "bg-mint/15 text-mint"
            : full
              ? "bg-surface2 text-muted"
              : "bg-accent text-white"
        }`}
        onClick={onJoin}
      >
        {joined
          ? s.myStatus === "confirmed"
            ? "✓ 확정됐어요"
            : "대기 중 · 자리가 나면 자동 확정"
          : busy
            ? "신청 중…"
            : full
              ? "대기 신청하기"
              : "참여 신청하기"}
      </button>
    </main>
  );
}
