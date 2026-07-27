"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { levelRangeLabel, missionLevel } from "@/lib/levels";
import { MOCK_SESSIONS, slotsLeft } from "@/lib/mock";

export default function SessionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const s = MOCK_SESSIONS.find((x) => x.id === id);

  if (!s) {
    return (
      <main className="px-4 pt-20 text-center text-muted">
        세션을 찾을 수 없어요
      </main>
    );
  }

  const left = slotsLeft(s);
  const full = left.male <= 0 && left.female <= 0;
  const mission = missionLevel(s.levelMin, s.levelMax);

  // 참가 현황 익명 배지 (블라인드 정책 — 프로필 미노출)
  const badges = [
    ...Array.from({ length: s.maleJoined }, (_, i) => ({ g: "m", key: `m${i}` })),
    ...Array.from({ length: s.femaleJoined }, (_, i) => ({ g: "f", key: `f${i}` })),
  ];

  return (
    <main className="px-4">
      <header className="flex items-center gap-3 pt-5 pb-4">
        <button onClick={() => router.back()} className="text-lg text-muted">
          ←
        </button>
        <h1 className="text-[19px] font-extrabold tracking-tight">세션 정보</h1>
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
          {Array.from({ length: left.male }, (_, i) => (
            <span
              key={`em${i}`}
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              남 모집중
            </span>
          ))}
          {Array.from({ length: left.female }, (_, i) => (
            <span
              key={`ef${i}`}
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              여 모집중
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          프로필은 공개되지 않아요. 세션이 시작되면 라운드마다 공통점 카드로 서로를
          알아가요.
        </p>
      </section>

      {/* 미션 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[14px] font-bold">🎥 함께 미션</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          라운드마다 짝과 함께{" "}
          <b className="text-ink">
            L{mission.id} {mission.name}({mission.colors})
          </b>{" "}
          이상 2문제에 도전하고 서로 영상을 찍어줘요. 완등 못 해도 영상만 올리면
          인정! 성공하면 크레딧이 쌓여요.
        </p>
      </section>

      {/* 안내 */}
      <section className="mt-4 flex flex-col gap-2 text-[12.5px] leading-relaxed text-muted">
        <p>💰 일일권+신발 대여 3만원 내외 · 현장 각자 결제</p>
        <p>🔒 노쇼 방지 보증금 1만원 · 참석 시 전액 환급</p>
        <p>👟 준비물: 운동복, 양말, 물 (신발은 대여 가능)</p>
        <p>✂️ 손톱은 짧게, 반지는 빼고 와주세요</p>
      </section>

      <button
        className={`mt-6 mb-8 w-full rounded-xl py-3.5 text-[15px] font-bold ${
          full ? "bg-surface2 text-muted" : "bg-accent text-white"
        }`}
        onClick={() =>
          alert(
            full
              ? "대기 신청했어요. 자리가 나면 순서대로 알려드릴게요. (목데이터 단계)"
              : "신청했어요! 성비가 맞으면 확정 알림을 보내드려요. (목데이터 단계)"
          )
        }
      >
        {full ? "대기 신청하기" : "참여 신청하기"}
      </button>
    </main>
  );
}
