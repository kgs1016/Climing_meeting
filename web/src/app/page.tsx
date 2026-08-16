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
  CREDIT_SESSION_VIDEO,
  REQUEST_COST,
  fetchAppFlags,
  fetchCredits,
  type AppFlags,
  fetchInboxCounts,
  fetchSentRequests,
  sendRequest,
  signedPhotoUrls,
  toSession,
  type Credits,
} from "@/lib/supabase";

const FILTERS = ["날짜", "짐", "레벨", "나이", "강도"];

export default function Home() {
  const router = useRouter();
  // Supabase 키가 없을 때만 목데이터로 화면을 본다 (개발 폴백).
  // 실제 배포에선 목데이터를 초기값으로 두면 안 된다 — 확인이 끝나기 전에
  // 존재하지 않는 모임이 1초쯤 그려진다.
  const mockMode = !hasSupabase();
  const [tab, setTab] = useState<"session" | "people">("session");
  const [me, setMe] = useState<MyProfile | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [flags, setFlags] = useState<AppFlags | null>(null);
  const [ready, setReady] = useState(mockMode);
  const [sessions, setSessions] = useState<Session[]>(mockMode ? MOCK_SESSIONS : []);
  const [people, setPeople] = useState<(Person & { intro?: string })[]>(
    mockMode ? MOCK_PEOPLE : []
  );
  const [live, setLive] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // 관심 보내기
  const [credits, setCredits] = useState<Credits | null>(null);
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
      setMe(prof);

      // 오픈 전에는 모임·사람을 잠근다 (대시보드 app_config 로 켠다)
      const f = await fetchAppFlags();
      setFlags(f);
      if (f && !f.sessions_open && !f.people_open) {
        const cr = await fetchCredits();
        if (cr) setCredits(cr);
        return;
      }

      const [rows, ppl] = await Promise.all([fetchSessions(), fetchPeople()]);
      if (prof) setMe(prof);
      if (rows) {
        setSessions(rows.map((r) => toSession(r, prof?.homeGym)));
        setLive(true);
      }
      // 비공개 버킷이라 표시용 서명 URL 을 한 번에 받아온다.
      // 사람 목록과 모임 호스트를 같이 넣어야 요청이 한 번으로 끝난다.
      const paths = [
        ...(ppl ?? []).map((x) => x.photo),
        ...(rows ?? []).map((r) => r.host_photo),
      ].filter(Boolean) as string[];
      if (ppl) setPeople(ppl);
      if (paths.length > 0) setPhotoUrls(await signedPhotoUrls(paths));

      const [sent, c, cr] = await Promise.all([
        fetchSentRequests(),
        fetchInboxCounts(),
        fetchCredits(),
      ]);
      if (sent) setSentTo(new Set(sent.map((s) => s.to_id)));
      if (c) setCounts(c);
      if (cr) setCredits(cr);

      setReady(true); // 여기까지 와야 목록을 그린다
    })();
  }, []);

  const REQ_ERRORS: Record<string, string> = {
    already: "이미 관심을 보낸 상대예요",
    same_gender: "이성에게만 보낼 수 있어요",
    not_public: "상대가 프로필을 내렸어요",
    no_profile: "먼저 내 프로필을 만들어주세요",
  };

  const sendReq = async () => {
    if (!reqTarget) return;
    setReqBusy(true);
    const r = await sendRequest(reqTarget.id, reqMsg);
    setReqBusy(false);

    if (r.error === "no_credits") {
      return alert(
        `크레딧이 부족해요.\n` +
          `관심 1회 = ${r.cost?.toLocaleString()}크레딧 · 지금 ${r.balance?.toLocaleString()}크레딧이에요.\n\n` +
          `모임에서 등반 영상을 올리면 +${CREDIT_SESSION_VIDEO} 크레딧이 쌓여요.`
      );
    }
    if (r.error) return alert(REQ_ERRORS[r.error] ?? `실패: ${r.error}`);

    setSentTo((s) => new Set(s).add(reqTarget.id));
    if (typeof r.balance === "number")
      setCredits((c) => (c ? { ...c, balance: r.balance! } : c));
    setReqTarget(null);
    alert(
      `${reqTarget.nickname}님에게 관심을 보냈어요!\n` +
        (r.spent ? `크레딧 -${r.cost} (남은 ${r.balance})` : "수락하면 채팅이 열려요.")
    );
  };

  // 프로필 작성 화면으로 넘어가는 중
  if (onboarding)
    return (
      <main className="px-4 pt-24 text-center text-muted">
        프로필 작성으로 이동 중…
      </main>
    );


  // 오픈 전 대기 화면 — 가입·프로필은 끝냈고 기능만 잠긴 상태
  if (flags && !flags.sessions_open && !flags.people_open) {
    const openDay = flags.open_at
      ? new Date(flags.open_at).toLocaleDateString("ko-KR", {
          month: "long",
          day: "numeric",
        })
      : null;
    return (
      <main className="px-4">
        <header className="pt-10 text-center">
          <p className="text-[17px] font-extrabold tracking-[2px] text-accent">
            HOBIDAY
          </p>
          <p className="mt-6 text-4xl">🧗</p>
          <h1 className="mt-4 text-[21px] font-extrabold leading-snug tracking-tight">
            가입 완료!
            {openDay && (
              <>
                <br />
                {openDay}에 모임이 열려요
              </>
            )}
          </h1>
          {flags.notice && (
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
              {flags.notice}
            </p>
          )}
        </header>

        <section className="mx-auto mt-8 max-w-sm rounded-2xl border border-mint/40 bg-mint/10 p-5 text-center">
          <p className="text-[12.5px] font-semibold text-muted">내 크레딧</p>
          <p className="mt-1 text-[32px] font-extrabold text-mint">
            {(credits?.balance ?? 0).toLocaleString()}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            오픈하면 관심 {Math.floor((credits?.balance ?? 0) / REQUEST_COST)}번을
            보낼 수 있어요
          </p>
        </section>

        <section className="mx-auto mt-4 max-w-sm rounded-2xl border border-line bg-surface p-5">
          <p className="text-[13.5px] font-bold">오픈하면 이런 걸 할 수 있어요</p>
          <div className="mt-3 flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-muted">
            <p>
              🧗 <b className="text-ink">모임 찾기</b> — 남녀 같은 수(1:1 · 2:2)로
              모여 함께 볼더링
            </p>
            <p>
              💌 <b className="text-ink">사람 찾기</b> — 마음에 드는 사람에게 관심
              보내기
            </p>
            <p>
              🎥 <b className="text-ink">등반 영상</b> — 서로 찍어주고 크레딧 적립
            </p>
            <p>
              🤫 <b className="text-ink">비공개 선택</b> — 서로 고른 경우에만 채팅
              개설
            </p>
          </div>
        </section>

        <div className="mx-auto mt-4 max-w-sm">
          <Link
            href="/profile/new"
            className="block rounded-xl border border-line bg-surface py-3.5 text-center text-[14px] font-bold text-muted"
          >
            내 프로필 다듬기
          </Link>
        </div>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-muted">
          오픈 소식은 가입하신 이메일로 알려드려요.
        </p>
      </main>
    );
  }

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
            하비데이가 뭔가요?
          </Link>
        </div>

        <section className="mx-auto mt-6 max-w-sm rounded-2xl border border-line bg-surface px-5 py-4 text-center">
          <p className="text-[13px] font-bold text-mint">
            8월 31일 오픈 · 지금은 사전 가입을 받고 있어요
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            조금만 기다려 주세요. 오픈하면{" "}
            <b className="text-ink">가입하신 이메일로</b> 알려드릴게요.
          </p>
        </section>

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-muted">
          참여자 프로필을 보호하려고 로그인 후에만 공개해요.
        </p>
      </main>
    );
  }

  // 위 화면들(온보딩·잠금·비로그인) 중 어느 것도 아닌데 아직 조회가 안 끝난 상태.
  // 여기서 목록을 그리면 빈 목록이나 목데이터가 잠깐 보인다.
  if (!ready) {
    return (
      <main className="px-4 pt-24 text-center">
        <p className="text-3xl">🧗</p>
        <p className="mt-3 text-[13.5px] text-muted">불러오는 중…</p>
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
              sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  hostPhotoUrl={s.host?.photo ? photoUrls[s.host.photo] : undefined}
                />
              ))
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
            <br />
            관심 1회 = <b className="text-mint">{REQUEST_COST}크레딧</b>
            {credits && ` · 내 크레딧 ${credits.balance}`}
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
              {reqBusy ? "보내는 중…" : `관심 보내기 (${REQUEST_COST}크레딧)`}
            </button>
            {credits && (
              <p className="mt-1.5 text-center text-[11.5px] text-muted">
                보내면 {Math.max(0, credits.balance - REQUEST_COST)}크레딧 남아요
              </p>
            )}
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
