"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { level } from "@/lib/levels";
import ReportSheet from "@/components/ReportSheet";
import {
  currentUser,
  fetchChatMessages,
  fetchChats,
  hasSupabase,
  markChatRead,
  sendChat,
  signedPhotoUrls,
  type Chat,
  type ChatMessage,
} from "@/lib/supabase";

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 방이 어떻게 열렸는지 — 모임에서 만났거나, 관심 수락으로 연결됐거나 */
const origin = (c: Chat) =>
  c.gym ? `${c.gym}에서 만났어요` : "관심을 수락해서 연결됐어요";

export default function ChatPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Chat | null>(null);

  const load = useCallback(async () => {
    const list = await fetchChats();
    setChats(list);
    if (list?.length)
      setPhotoUrls(
        await signedPhotoUrls(list.map((c) => c.photo).filter(Boolean) as string[])
      );
  }, []);

  useEffect(() => {
    (async () => {
      if (!hasSupabase()) return setAuthed(false);
      const user = await currentUser();
      setAuthed(!!user);
      if (user) load();
    })();
  }, [load]);

  /** 방을 열면 읽음으로 표시한다 (목록의 배지가 바로 사라지게 낙관적 갱신) */
  const openThread = async (c: Chat) => {
    setOpen(c);
    setChats((list) =>
      (list ?? []).map((x) => (x.match_id === c.match_id ? { ...x, unread: 0 } : x))
    );
    await markChatRead(c.match_id);
  };

  if (authed === false)
    return (
      <main className="px-4">
        <header className="pt-6 pb-4">
          <h1 className="text-[19px] font-extrabold tracking-tight">채팅</h1>
        </header>
        <div className="mt-14 flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-muted">로그인하면 대화가 보여요</p>
          <Link
            href="/login"
            className="rounded-xl bg-accent px-6 py-2.5 text-[14px] font-bold text-white"
          >
            로그인 하기
          </Link>
        </div>
      </main>
    );

  if (open)
    return (
      <Thread
        chat={open}
        onBack={() => {
          setOpen(null);
          load(); // 나올 때 목록·마지막 메시지 갱신
        }}
      />
    );

  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">채팅</h1>
      </header>

      {chats === null ? (
        <p className="pt-14 text-center text-muted">불러오는 중…</p>
      ) : chats.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">💬</span>
          <p className="text-[15px] font-bold">아직 매칭된 상대가 없어요</p>
          <p className="text-[13px] leading-relaxed text-muted">
            모임이 끝나고 서로 선택하면
            <br />
            여기서 대화가 시작돼요
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-6">
          {chats.map((c) => (
            <button
              key={c.match_id}
              onClick={() => openThread(c)}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left"
            >
              {c.photo && photoUrls[c.photo] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrls[c.photo]}
                  alt={c.nickname}
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl">
                  🧗
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-extrabold">
                  {c.nickname}
                  <span className="ml-1.5 text-[12px] font-medium text-muted">
                    {c.age} · L{c.level} {level(c.level).name}
                  </span>
                </p>
                <p
                  className={`mt-0.5 truncate text-[12.5px] ${
                    c.unread > 0 ? "font-semibold text-ink" : "text-muted"
                  }`}
                >
                  {c.last_body ?? origin(c)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11.5px] text-muted">{when(c.last_at)}</span>
                {c.unread > 0 && (
                  <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[11px] font-extrabold leading-[18px] text-white">
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Thread({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setMsgs(await fetchChatMessages(chat.match_id));
    // 방을 보고 있는 동안 도착한 메시지도 읽음 처리한다
    await markChatRead(chat.match_id);
  }, [chat.match_id]);

  useEffect(() => {
    load();
    // 실시간 대신 폴링 — 규모가 작을 때는 이게 단순하고 확실하다
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  /* 키보드가 올라오면 iOS 는 fixed 요소를 줄이지 않고 화면을 스크롤한다.
     그러면 입력창만 보이고 헤더·대화가 화면 밖으로 밀려난다.
     visualViewport 로 "실제 보이는 영역"을 받아 그 높이에 맞춘다. */
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);

  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return; // 미지원 브라우저는 h-dvh 폴백
    const update = () => setVv({ h: v.height, top: v.offsetTop });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, []);

  // 키보드가 열렸으면 홈바 여백을 넣지 않는다 (키보드 위에 빈 틈이 생김)
  const keyboardOpen = !!vv && vv.h < window.innerHeight - 100;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length, vv?.h]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const r = await sendChat(chat.match_id, body);
    setBusy(false);
    if (r.error) return alert(`전송 실패: ${r.error}`);
    setText("");
    load();
  };

  /* 전체화면 오버레이로 띄운다.
     레이아웃 래퍼가 하단 네비용 padding-bottom 을 갖고 있어서, 그 안에서
     min-h-screen + sticky 로 입력창을 붙이면 화면 밖으로 밀려난다.
     높이는 visualViewport 값으로 직접 지정한다 (inset-0 은 키보드를 모른다). */
  return (
    <div
      className="fixed inset-x-0 top-0 z-40 mx-auto flex h-dvh max-w-md flex-col bg-bg px-4"
      style={{
        height: vv ? `${vv.h}px` : undefined,
        transform: vv ? `translateY(${vv.top}px)` : undefined,
        paddingBottom: keyboardOpen ? 0 : "env(safe-area-inset-bottom)",
      }}
    >
      <header
        className="flex shrink-0 items-center gap-3 pb-3"
        style={{
          paddingTop: keyboardOpen
            ? "0.75rem"
            : "calc(1.25rem + env(safe-area-inset-top))",
        }}
      >
        <button onClick={onBack} className="text-lg text-muted">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-extrabold tracking-tight">
            {chat.nickname}
          </h1>
          <p className="text-[11.5px] text-muted">
            {origin(chat)} · L{chat.level} {level(chat.level).name}
          </p>
        </div>
        <button
          onClick={() => setReporting(true)}
          aria-label="신고하기"
          className="shrink-0 px-2 py-1 text-[12px] font-semibold text-muted/70"
        >
          신고
        </button>
      </header>

      {/* min-h-0 이 없으면 flex 아이템이 내용만큼 커져서 스크롤이 안 걸린다 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {msgs === null ? (
          <p className="pt-10 text-center text-muted">불러오는 중…</p>
        ) : msgs.length === 0 ? (
          <p className="px-6 pt-10 text-center text-[13px] leading-relaxed text-muted">
            서로를 선택해서 열린 방이에요.
            <br />
            먼저 말을 걸어보세요 🧗
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
                  m.mine
                    ? "self-end rounded-br-md bg-accent text-white"
                    : "self-start rounded-bl-md bg-surface2 text-ink"
                }`}
              >
                {m.body}
                <span
                  className={`ml-2 align-bottom text-[10.5px] ${
                    m.mine ? "text-white/70" : "text-muted"
                  }`}
                >
                  {when(m.created_at)}
                </span>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex shrink-0 gap-2 bg-bg py-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지 보내기"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-muted/60"
        />
        <button
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-xl bg-accent px-4 text-[14px] font-bold text-white disabled:opacity-40"
        >
          전송
        </button>
      </form>

      {reporting && (
        <ReportSheet
          targetId={chat.partner_id}
          nickname={chat.nickname}
          context="chat"
          refId={chat.match_id}
          onClose={() => setReporting(false)}
          // 차단되면 이 방은 더 열리지 않는다 — 목록으로 돌려보낸다
          onDone={onBack}
        />
      )}
    </div>
  );
}
