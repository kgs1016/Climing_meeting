"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { level } from "@/lib/levels";
import {
  currentUser,
  fetchChatMessages,
  fetchChats,
  hasSupabase,
  sendChat,
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

export default function ChatPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [open, setOpen] = useState<Chat | null>(null);

  useEffect(() => {
    (async () => {
      if (!hasSupabase()) return setAuthed(false);
      const user = await currentUser();
      setAuthed(!!user);
      if (user) setChats(await fetchChats());
    })();
  }, []);

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

  if (open) return <Thread chat={open} onBack={() => setOpen(null)} />;

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
              onClick={() => setOpen(c)}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xl">
                🧗
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-extrabold">
                  {c.nickname}
                  <span className="ml-1.5 text-[12px] font-medium text-muted">
                    {c.age} · L{c.level} {level(c.level).name}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-muted">
                  {c.last_body ?? `${c.gym}에서 만났어요`}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px] text-muted">
                {when(c.last_at)}
              </span>
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
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setMsgs(await fetchChatMessages(chat.match_id));
  }, [chat.match_id]);

  useEffect(() => {
    load();
    // 실시간 대신 폴링 — 규모가 작을 때는 이게 단순하고 확실하다
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

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

  return (
    <main className="flex min-h-screen flex-col px-4">
      <header className="flex items-center gap-3 pt-5 pb-3">
        <button onClick={onBack} className="text-lg text-muted">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-extrabold tracking-tight">
            {chat.nickname}
          </h1>
          <p className="text-[11.5px] text-muted">
            {chat.gym}에서 만났어요 · L{chat.level} {level(chat.level).name}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-3">
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

      <form onSubmit={send} className="sticky bottom-0 flex gap-2 bg-bg py-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지 보내기"
          maxLength={1000}
          className="flex-1 rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] text-ink placeholder:text-muted/60"
        />
        <button
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-xl bg-accent px-4 text-[14px] font-bold text-white disabled:opacity-40"
        >
          전송
        </button>
      </form>
    </main>
  );
}
