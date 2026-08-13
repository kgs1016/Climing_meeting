"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isProfileComplete } from "@/lib/profileGate";
import SessionCard from "@/components/SessionCard";
import ProfileTodo from "@/components/ProfileTodo";
import { MOCK_SESSIONS, MOCK_PEOPLE, type Session, type Person } from "@/lib/mock";
import { careerLabel, level } from "@/lib/levels";
import { loadMyProfile, type MyProfile } from "@/lib/myProfile";
import {
  hasSupabase,
  currentUser,
  fetchSessions,
  fetchPeople,
  fetchMyProfileDb,
  fetchInboxCounts,
  fetchSentRequests,
  sendRequest,
  signedPhotoUrls,
  toSession,
} from "@/lib/supabase";

const FILTERS = ["날짜", "짐", "레벨", "나이", "강도"];

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"session" | "people">("session");
  const [me, setMe] = useState<MyProfile | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [sessions, setSessions] = useState<Session[]>(MOCK_SESSIONS);
  const [people, setPeople] = useState<(Person & { intro?: string })[]>(MOCK_PEOPLE);
  const [live, setLive] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // 관심 보내기
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof fetchInboxCounts>>>(null);
  const [reqTarget, setReqTarget] = useState<Person | null>(null);
  const [reqMsg, setReqMsg] = useState("");
  const [reqBusy, setReqBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#people") setTab("people");

    (async () => {
      if (!hasSupabase()) {
        setMe(loadMyProfile());
        setAuthed(null);
        return;
      }
      const user = await currentUser();
      setAuthed(!!user);

      // 비로그인은 DB가 아무것도 안 내려준다. 목데이터가 실제 모임처럼
      // 보이는 걸 막으려고 조회 자체를 하지 않는다.
      if (!user) return;

      // 프로필(사진 포함)을 먼저 완성해야 둘러볼 수 있다
      const prof = await fetchMyProfileDb();
      if (!isProfileComplete(prof)) {
        setOnboarding(true);
        router.replace("/profile/new");
        return;
      }

      const [rows, ppl] = await Promise.all([fetchSessions(), fetchPeople()]);
      if (prof) setMe(prof);
      if (rows) {
        setSessions(rows.map((r) => toSession(r, prof?.homeGym)));
        setLive(true);
      }
      if (ppl) {
        setPeople(ppl);
        // 비공개 버킷이라 표시용 서명 URL 을 한 번에 받아온다
        setPhotoUrls(
          await signedPhotoUrls(ppl.map((x) => x.photo).filter(Boolean) as string[])
        );
      }

      const [sent, c] = await Promise.all([fetchSentRequests(), fetchInboxCounts()]);
      if (sent) setSentTo(new Set(sent.map((s) => s.to_id)));
      if (c) setCounts(c);
    })();
  }, []);

  const REQ_ERRORS: Record<string, string> = {
    already: "이미 관심을 보낸 상대예요",
    same_gender: "이성에게만 보낼 수 있어요",
    not_public: "상대가 프로필을 내렸어요",
    no_profile: "먼저 내 프로필을 만들어주세요",
    limit: "오늘 보낼 수 있는 관심을 다 썼어요. 내일 다시 시도해주세요",
  };

  const sendReq = async () => {
    if (!reqTarget) return;
    setReqBusy(true);
    const r = await sendRequest(reqTarget.id, reqMsg);
    setReqBusy(false);
    if (r.error) return alert(REQ_ERRORS[r.error] ?? `실패: ${r.error}`);
    setSentTo((s) => new Set(s).add(reqTarget.id));
    setCounts((c) => (c ? { ...c, sent_today: c.sent_today + 1 } : c));
    setReqTarget(null);
    alert(`${reqTarget.nickname}님에게 관심을 보냈어요!\n수락하면 채팅이 열려요.`);
  };

  // 프로필 작성 화면으로 넘어가는 중
  if (onboarding)
    return (
      <main className="px-4 pt-24 text-center text-muted">
        프로필 작성으로 이동 중…
      </main>
    );

  // 비로그인 게이트 — authed 가 null 인 동안(확인 중)은 띄우지 않아 깜빡임이 없다
  if (authed === false) {
    return (
      <main className="px-4">
        <header className="pt-16 text-center">
          <p className="text-[17px] font-extrabold tracking-[2px] text-accent">
            HOBIDAY
          </p>
          <h1 className="mt-4 text-[21px] font-extrabold leading-snug tracking-tight">
            취미로 시작해서,
            <br />
            사람으로 끝나는 하루
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
            남녀 같은 수로 모이는 2시간 볼더링.
            <br />
            모임과 프로필은 로그인 후에 볼 수 있어요.
          </p>
        </header>

        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
          <Link
            href="/login"
            className="rounded-xl bg-accent py-3.5 text-center text-[15px] font-bold text-white"
          >
            로그인 하기
          </Link>
          <Link
            href="/intro.html"
            className="rounded-xl border border-line bg-surface py-3.5 text-center text-[14px] font-bold text-muted"
          >
            호비데이가 뭔가요?
          </Link>
        </div>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-muted">
          참여자 프로필을 보호하려고 로그인 후에만 공개해요.
        </p>
      </main>
    );
  }

  return (
    <main className="px-4">
      {/* 헤더 */}
      <header className="pt-6 pb-4">
        <p className="text-[17px] font-extrabold tracking-[2px] text-accent">
          HOBIDAY
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/session/new"
            className="rounded-xl bg-accent py-3 text-center text-[14px] font-bold text-white"
          >
            + 모임 만들기
          </Link>
          <Link
            href="/profile/new"
            className="rounded-xl border border-line bg-surface py-3 text-center text-[14px] font-bold text-muted"
          >
            {me ? "내 프로필 관리" : "+ 내 프로필 올리기"}
          </Link>
        </div>
      </header>

      {/* 탭 */}
      <div className="flex border-b border-line">
        {(
          [
            ["session", "모임 찾기"],
            ["people", "사람 찾기"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 pb-2.5 pt-1 text-[15px] font-bold ${
              tab === key ? "border-b-2 border-accent text-ink" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "session" ? (
        <>
          {/* 필터 (목업 — 다음 단계에서 동작) */}
          <div className="flex gap-1.5 overflow-x-auto py-3 [-ms-overflow-style:none] [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <span
                key={f}
                className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-muted"
              >
                {f} ▾
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-3 pb-6">
            {!live && hasSupabase() === false && (
              <p className="rounded-xl border border-dashed border-line px-4 py-2.5 text-center text-[11.5px] text-muted">
                미리보기 데이터예요 · Supabase 연결 후 실제 모임이 표시됩니다
              </p>
            )}
            {sessions.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-3xl">🧗</p>
                <p className="mt-2 text-[14px] font-bold">아직 열린 모임이 없어요</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  첫 모임을 직접 열어보세요!
                </p>
              </div>
            ) : (
              sessions.map((s) => <SessionCard key={s.id} session={s} />)
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3 py-4 pb-6">
          {/* 내 프로필 (공개 중) */}
          {me ? (
            <div className="rounded-2xl border border-mint/40 bg-mint/5 p-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl ${
                    me.gender === "f" ? "bg-female/15" : "bg-male/15"
                  }`}
                >
                  🧗
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-[15px]">
                    {me.nickname}
                    <span className="ml-1.5 rounded-full bg-mint/15 px-2 py-0.5 text-[10.5px] font-bold text-mint align-middle">
                      공개 중
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {me.age} · {me.area} · L{me.level} {level(me.level).name} ·{" "}
                    {me.homeGym} · {me.mbti}
                  </p>
                  {me.intro && (
                    <p className="mt-1 text-[12.5px] text-ink/85">
                      &ldquo;{me.intro}&rdquo;
                    </p>
                  )}
                </div>
                <Link
                  href="/profile/new"
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-muted"
                >
                  관리
                </Link>
              </div>
            </div>
          ) : (
            <Link
              href="/profile/new"
              className="rounded-xl border border-dashed border-line bg-surface2 px-4 py-3.5 text-center text-[13px] font-semibold text-muted"
            >
              + 내 프로필을 올리면 여기에 공개돼요
            </Link>
          )}

          {me && <ProfileTodo profile={me} />}

          <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
            관심을 보내면 상대 신청함에 도착해요. 상대가 수락하면{" "}
            <b className="text-ink">채팅이 열려요.</b>
            {counts && (
              <>
                <br />
                오늘 {counts.daily_limit - counts.sent_today}번 더 보낼 수 있어요.
              </>
            )}
          </p>

          {people.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4"
            >
              {p.photo && photoUrls[p.photo] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrls[p.photo]}
                  alt={p.nickname}
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl ${
                    p.gender === "f" ? "bg-female/15" : "bg-male/15"
                  }`}
                >
                  🧗
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-[15px]">
                  {p.nickname}
                  <span className="ml-1.5 text-[12.5px] font-medium text-muted">
                    {[p.age, p.height && `${p.height}cm`, p.area]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-muted">
                  {[
                    `L${p.level} ${level(p.level).name}`,
                    careerLabel(p.careerId) && `구력 ${careerLabel(p.careerId)}`,
                    p.homeGym,
                    p.mbti,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.intro && (
                  <p className="mt-1 truncate text-[12.5px] text-ink/85">
                    &ldquo;{p.intro}&rdquo;
                  </p>
                )}
              </div>
              {/* 관심 하나로 통일 — 보내면 상대 신청함에 뜨고, 수락하면 채팅이 열린다 */}
              <button
                disabled={sentTo.has(p.id)}
                onClick={() => {
                  setReqTarget(p);
                  setReqMsg("");
                }}
                className={`shrink-0 rounded-lg px-3 py-2 text-[12px] font-bold ${
                  sentTo.has(p.id)
                    ? "border border-line text-muted"
                    : "bg-accent text-white"
                }`}
              >
                {sentTo.has(p.id) ? "보냈어요" : "관심"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 관심 보내기 시트 — 한 줄 메시지를 붙이면 받는 쪽이 맥락을 보고 판단한다 */}
      {reqTarget && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/60"
          onClick={() => setReqTarget(null)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-2xl border-t border-line bg-surface p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[16px] font-extrabold">
              {reqTarget.nickname}님에게 관심 보내기
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              한 줄 남기면 수락될 가능성이 높아요. 비워도 됩니다.
            </p>
            <textarea
              value={reqMsg}
              onChange={(e) => setReqMsg(e.target.value.slice(0, 200))}
              rows={3}
              placeholder={`예: 같은 ${reqTarget.homeGym} 다니네요! 주말에 같이 타요`}
              className="mt-3 w-full resize-none rounded-xl border border-line bg-surface2 px-3.5 py-3 text-[16px] text-ink placeholder:text-muted/60"
            />
            <p className="mt-1 text-right text-[11.5px] text-muted">
              {reqMsg.length}/200
            </p>
            <button
              disabled={reqBusy}
              onClick={sendReq}
              className="mt-2 w-full rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {reqBusy ? "보내는 중…" : "관심 보내기"}
            </button>
            <button
              onClick={() => setReqTarget(null)}
              className="mt-2 w-full py-2 text-[13px] font-semibold text-muted"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
