"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { careerLabel, level, missionLevel } from "@/lib/levels";
import { buildCard, type CardProfile, type Tier } from "@/lib/matchCard";
import {
  fetchMatches,
  fetchMyProfileDb,
  fetchRoom,
  markMissionDone,
  submitSelection,
  type Room,
  type RoomPartner,
  type RoomRound,
} from "@/lib/supabase";

/* 워밍업 가이드 — 이 20분이 원래 가장 어색한 구간이라
   같이 할 거리를 주면 아이스브레이킹·부상예방·클린이 배려가 한 번에 해결된다. */
const WARMUP = [
  ["손가락·손목", "가볍게 돌리고 늘려주세요. 여기서 다치는 사람이 제일 많아요"],
  ["어깨·등", "팔 돌리기 20회. 어깨가 안 풀리면 다음날 아파요"],
  ["쉬운 문제 2~3개", "제일 낮은 색으로 몸 풀기. 완등이 목적이 아니에요"],
  ["낙법", "매트에 엉덩이부터. 손목으로 짚지 않기"],
];

const TIER_STYLE: Record<Tier, string> = {
  hit: "border border-accent/45 bg-accent/10",
  mid: "bg-surface2",
  diff: "bg-surface2",
};
const TIER_LABEL: Record<Tier, string> = {
  hit: "일치",
  mid: "겹침",
  diff: "궁금",
};
const TIER_TAG: Record<Tier, string> = {
  hit: "bg-accent text-white",
  mid: "border border-line bg-surface text-mint",
  diff: "border border-line bg-surface text-muted",
};

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const toCard = (p: RoomPartner): CardProfile => ({
  nickname: p.nickname,
  age: p.age,
  level: p.level,
  career: p.career,
  homeGym: p.home_gym,
  area: p.area,
  mbti: p.mbti,
  intro: p.intro,
});

const ERRORS: Record<string, string> = {
  no_profile: "먼저 프로필을 만들어주세요",
  not_found: "모임을 찾을 수 없어요",
  not_confirmed: "확정된 참가자만 볼 수 있어요",
  not_enough: "아직 인원이 모이지 않았어요 (최소 2:2)",
  overflow: "이번 모임은 자리가 찼어요. 다음 모임 우선권을 드렸어요!",
};

export default function Room({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [room, setRoom] = useState<Room | null>(null);
  // 공통점 카드는 내 프로필과 비교해야 만들어진다
  const [mine, setMine] = useState<CardProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof fetchMatches>>>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([fetchRoom(id), fetchMyProfileDb()]);
    if (r.error) return setErr(r.error);
    setRoom(r.room!);
    if (p)
      setMine({
        nickname: p.nickname,
        age: p.age,
        level: p.level,
        career: p.careerId ?? null,
        homeGym: p.homeGym,
        area: p.area,
        mbti: p.mbti,
        intro: p.intro,
      });
    if (r.room!.selection_open) setMatches(await fetchMatches(id));
  }, [id]);

  useEffect(() => {
    load();
    // 라운드가 시간에 따라 열리므로 주기적으로 다시 확인한다
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (err)
    return (
      <main className="px-4 pt-24 text-center">
        <p className="text-3xl">🧗</p>
        <p className="mt-3 text-[15px] font-bold">{ERRORS[err] ?? err}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-6 rounded-xl bg-accent px-6 py-2.5 text-[14px] font-bold text-white"
        >
          홈으로
        </button>
      </main>
    );

  if (!room)
    return <main className="px-4 pt-20 text-center text-muted">불러오는 중…</main>;

  const onMission = async (round: number) => {
    setBusy(true);
    const r = await markMissionDone(id, round);
    setBusy(false);
    if (r.error) return alert(`실패: ${r.error}`);
    load();
  };

  const onSubmit = async () => {
    if (!confirm("제출하면 상대에게는 알리지 않아요. 서로 선택한 경우에만 열려요.\n제출할까요?"))
      return;
    setBusy(true);
    const r = await submitSelection(id, [...picked]);
    setBusy(false);
    if (r.error) return alert(`실패: ${r.error}`);
    setSubmitted(true);
    setMatches(await fetchMatches(id));
  };

  const met = room.rounds
    .map((r) => r.partner)
    .filter((p): p is RoomPartner => !!p);

  return (
    <main className="px-4 pb-10">
      <header className="flex items-center gap-3 pt-5 pb-4">
        <button onClick={() => router.back()} className="text-lg text-muted">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[19px] font-extrabold tracking-tight">
            {room.session.gym}
          </h1>
          <p className="text-[12px] text-muted">
            {hhmm(room.session.starts_at)} 시작 · 나는{" "}
            {room.me.gender === "f" ? "여성" : "남성"} {room.me.slot + 1}번
          </p>
        </div>
      </header>

      {/* 워밍업 */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[14px] font-bold">
          👋 다 같이 워밍업{" "}
          <span className="font-medium text-muted">{room.warmup_min}분</span>
        </h2>
        <div className="mt-3 flex flex-col gap-2.5">
          {WARMUP.map(([t, d]) => (
            <div key={t} className="flex gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <div>
                <p className="text-[13.5px] font-bold">{t}</p>
                <p className="text-[12.5px] text-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 라운드 */}
      {room.rounds.map((r) => (
        <RoundBlock
          key={r.round}
          round={r}
          me={mine}
          myLevel={room.me.level}
          busy={busy}
          onMission={() => onMission(r.round)}
        />
      ))}

      {/* 최종선택 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[14px] font-bold">💌 비공개 최종선택</h2>

        {!room.selection_open ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            마지막 라운드가 시작되면 열려요. 다시 만나고 싶은 사람을 조용히
            고르면 되고, <b className="text-ink">서로 고른 경우에만</b> 채팅이
            열려요.
          </p>
        ) : matches && matches.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[13px] font-bold text-mint">
              🎉 서로 선택했어요!
            </p>
            {matches.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-mint/40 bg-mint/10 px-3.5 py-3"
              >
                <p className="text-[14px] font-extrabold">
                  {m.nickname}
                  <span className="ml-1.5 text-[12px] font-medium text-muted">
                    {m.age} · {m.home_gym}
                  </span>
                </p>
              </div>
            ))}
            <p className="mt-1 text-[12px] text-muted">
              채팅은 다음 업데이트에서 열려요.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              다시 만나고 싶은 사람을 고르세요. <b className="text-ink">아무도 안 골라도 괜찮아요.</b>
              <br />
              상대에게는 알리지 않아요.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {met.map((p) => {
                const on = picked.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                    className={`flex items-center justify-between rounded-xl px-3.5 py-3 text-left ${
                      on ? "border border-accent bg-accent/10" : "border border-line bg-surface2"
                    }`}
                  >
                    <span className="text-[14px] font-bold">
                      {p.nickname}
                      <span className="ml-1.5 text-[12px] font-medium text-muted">
                        {p.age} · L{p.level}
                      </span>
                    </span>
                    <span className={on ? "text-accent" : "text-muted"}>
                      {on ? "♥" : "♡"}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              disabled={busy}
              onClick={onSubmit}
              className="mt-3 w-full rounded-xl bg-accent py-3 text-[14px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "제출 중…" : `선택 제출하기 (${picked.size}명)`}
            </button>

            {submitted && (
              // 제출했는데 화면이 그대로면 됐는지 알 수 없다. 상대의 선택은
              // 아직 알 수 없으므로 "기다리는 중"까지만 알려준다.
              <p className="mt-2.5 rounded-lg bg-surface2 px-3 py-2.5 text-center text-[12.5px] leading-relaxed text-muted">
                ✓ 제출했어요. 상대도 나를 고르면 여기에 뜨고,
                <br />
                아니면 아무 일도 일어나지 않아요. 다시 골라도 돼요.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function RoundBlock({
  round,
  me,
  myLevel,
  busy,
  onMission,
}: {
  round: RoomRound;
  me: CardProfile | null;
  myLevel: Room["me"]["level"];
  busy: boolean;
  onMission: () => void;
}) {
  // 라운드가 열리기 전에는 서버가 상대를 안 내려준다 — 여기서 가릴 수 있는 게 아니다
  if (!round.is_open || !round.partner) {
    return (
      <section className="mt-3 rounded-2xl border border-dashed border-line p-4 text-center">
        <p className="text-[13.5px] font-bold text-muted">
          라운드 {round.round} · {hhmm(round.starts_at)} 시작
        </p>
        <p className="mt-1 text-[12px] text-muted">
          🔒 {hhmm(round.card_open_at)}에 상대 카드가 열려요
        </p>
      </section>
    );
  }

  const p = round.partner;
  const card = me ? buildCard(me, toCard(p)) : null;
  const mission = missionLevel(myLevel, p.level);

  return (
    <section className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[14px] font-bold">
          🧗 라운드 {round.round}{" "}
          <span className="font-medium text-muted">{hhmm(round.starts_at)}</span>
        </h2>
        {round.mission_done && (
          <span className="text-[12px] font-bold text-mint">✓ 미션 완료</span>
        )}
      </div>

      <p className="mt-2 text-[16px] font-extrabold">
        {p.nickname}
        <span className="ml-1.5 text-[12.5px] font-medium text-muted">
          {[p.age, careerLabel(p.career) && `구력 ${careerLabel(p.career)}`, p.home_gym]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>

      {/* 공통점 카드 */}
      {card && (
        <>
          <div className="mt-3 flex flex-col gap-1.5">
            {card.rows.map((row, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${TIER_STYLE[row.tier]}`}
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${TIER_TAG[row.tier]}`}
                >
                  {TIER_LABEL[row.tier]}
                </span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>

          {card.quote && (
            <div className="mt-3 rounded-r-lg border-l-[3px] border-mint bg-surface2 px-3 py-2">
              <p className="text-[11.5px] text-muted">상대가 쓴 한마디</p>
              <p className="text-[13px]">&ldquo;{card.quote}&rdquo;</p>
            </div>
          )}

          <div className="mt-3 rounded-lg border border-mint/30 bg-mint/10 px-3 py-2">
            <p className="text-[11.5px] font-bold text-mint">💬 대화 씨앗</p>
            <p className="text-[13px]">{card.seed}</p>
          </div>
        </>
      )}

      {/* 미션 */}
      <div className="mt-3 rounded-xl bg-surface2 p-3">
        <p className="text-[13px] font-bold">
          🎥 함께 {mission.colors} 2문제
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          둘 중 편한 쪽 기준이에요. <b className="text-ink">완등 못 해도 괜찮아요</b> —
          서로 영상 찍어주는 게 진짜 미션이에요.
        </p>
        <button
          disabled={busy || round.mission_done}
          onClick={onMission}
          className={`mt-2.5 w-full rounded-lg py-2.5 text-[13px] font-bold disabled:opacity-60 ${
            round.mission_done ? "bg-mint/15 text-mint" : "bg-accent text-white"
          }`}
        >
          {round.mission_done ? "✓ 완료했어요" : "미션 완료 체크"}
        </button>
      </div>
    </section>
  );
}
