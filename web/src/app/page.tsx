"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SessionCard from "@/components/SessionCard";
import { MOCK_SESSIONS, MOCK_PEOPLE } from "@/lib/mock";
import { level } from "@/lib/levels";
import { loadMyProfile, type MyProfile } from "@/lib/myProfile";

const FILTERS = ["날짜", "짐", "레벨", "나이", "강도"];

export default function Home() {
  const [tab, setTab] = useState<"session" | "people">("session");
  const [me, setMe] = useState<MyProfile | null>(null);

  useEffect(() => {
    if (window.location.hash === "#people") setTab("people");
    setMe(loadMyProfile());
  }, []);

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
          {/* 필터 (목업 — 동작은 Supabase 연결 후) */}
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
            {MOCK_SESSIONS.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
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

          <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
            사람 찾기는 프로필이 공개돼요. 신청은{" "}
            <b className="text-ink">신청권</b>을 사용합니다. (MVP 다음 단계)
          </p>

          {MOCK_PEOPLE.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4"
            >
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl ${
                  p.gender === "f" ? "bg-female/15" : "bg-male/15"
                }`}
              >
                🧗
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-[15px]">
                  {p.nickname}
                  <span className="ml-1.5 text-[12.5px] font-medium text-muted">
                    {p.age} · {p.area}
                  </span>
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  L{p.level} {level(p.level).name} · {p.homeGym} · {p.mbti}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <button className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-muted">
                  관심
                </button>
                <button className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-white">
                  신청
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
