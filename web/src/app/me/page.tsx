"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProfileTodo from "@/components/ProfileTodo";
import { careerLabel, level } from "@/lib/levels";
import type { MyProfile } from "@/lib/myProfile";
import { loadMyProfile } from "@/lib/myProfile";
import {
  CREDIT_LABELS,
  CREDIT_SESSION_VIDEO,
  REQUEST_COST,
  getSupabase,
  hasSupabase,
  currentUser,
  fetchCredits,
  fetchMyProfileDb,
  fetchMyVideos,
  type Credits,
} from "@/lib/supabase";

export default function Me() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [videoCount, setVideoCount] = useState(0);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!hasSupabase()) {
        setProfile(loadMyProfile());
        setLoading(false);
        return;
      }
      const user = await currentUser();
      if (!user) {
        // 비로그인 상태면 곧바로 로그인 화면으로
        router.replace("/login");
        return;
      }
      setEmail(user.email ?? "");
      const [prof, vids, cr] = await Promise.all([
        fetchMyProfileDb(),
        fetchMyVideos(),
        fetchCredits(),
      ]);
      setProfile(prof);
      setVideoCount(vids?.length ?? 0);
      setCredits(cr);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await getSupabase()?.auth.signOut();
    router.replace("/login");
  };

  if (loading)
    return <main className="px-4 pt-20 text-center text-muted">불러오는 중…</main>;

  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">내 정보</h1>
      </header>

      <>
          <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-2xl">
              🧗
            </div>
            <div className="min-w-0 flex-1">
              {profile ? (
                <>
                  <p className="text-[17px] font-extrabold">{profile.nickname}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    L{profile.level} {level(profile.level).name} (
                    {level(profile.level).colors}) · {profile.homeGym}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {[
                      careerLabel(profile.careerId) &&
                        `구력 ${careerLabel(profile.careerId)}`,
                      profile.height && `${profile.height}cm`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-extrabold">프로필이 아직 없어요</p>
                  <Link
                    href="/profile/new"
                    className="mt-1 inline-block text-[13px] font-bold text-accent"
                  >
                    프로필 만들기 →
                  </Link>
                </>
              )}
              {email && (
                <p className="mt-0.5 truncate text-[11.5px] text-muted">{email}</p>
              )}
            </div>
          </section>

          {profile && (
            <div className="mt-3">
              <ProfileTodo profile={profile} />
            </div>
          )}

          <section className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowCredits((v) => !v)}
              className="rounded-2xl border border-line bg-surface p-4 text-left"
            >
              <p className="text-[12px] font-semibold text-muted">
                크레딧 {credits && credits.history.length > 0 && (showCredits ? "▾" : "▸")}
              </p>
              <p className="mt-1 text-[19px] font-extrabold text-mint">
                {credits?.balance ?? 0}
              </p>
            </button>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-[12px] font-semibold text-muted">내 영상</p>
              <p className="mt-1 text-[19px] font-extrabold">🎥 {videoCount}</p>
            </div>
          </section>

          {showCredits && credits && (
            <section className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
              {credits.history.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] leading-relaxed text-muted">
                  아직 내역이 없어요. 모임에서 미션을 하면 쌓여요 — 영상까지
                  올리면 더 많이 받아요.
                </p>
              ) : (
                credits.history.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b border-line px-4 py-2.5 last:border-b-0"
                  >
                    <span className="text-[13px]">
                      {CREDIT_LABELS[h.reason] ?? h.reason}
                    </span>
                    <span
                      className={`text-[13px] font-extrabold ${
                        h.delta > 0 ? "text-mint" : "text-muted"
                      }`}
                    >
                      {h.delta > 0 ? `+${h.delta}` : h.delta}
                    </span>
                  </div>
                ))
              )}
              <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-muted">
                관심 1회에 {REQUEST_COST}크레딧을 써요. 모임에서 등반 영상을
                올리면 한 번에 {CREDIT_SESSION_VIDEO}크레딧이 쌓여요.
              </p>
            </section>
          )}

          <section className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            <Link
              href="/profile/new"
              className="flex items-center justify-between border-b border-line px-4 py-3.5 text-left text-[14px] font-semibold"
            >
              프로필 수정
              <span className="text-muted">›</span>
            </Link>
            {["취향 설문 (다음 단계)", "내 영상 보관함 (다음 단계)", "안전 설정 (다음 단계)"].map(
              (item) => (
                <button
                  key={item}
                  className="flex items-center justify-between border-b border-line px-4 py-3.5 text-left text-[14px] font-semibold text-muted last:border-b-0"
                >
                  {item}
                  <span>›</span>
                </button>
              )
            )}
          </section>

          {email && (
            <button
              onClick={logout}
              className="mt-4 w-full rounded-xl border border-line py-3 text-[13.5px] font-bold text-muted"
            >
              로그아웃
            </button>
          )}
        </>

      <p className="mt-6 text-center text-[11.5px] text-muted">
        HOBIDAY — 취미로 시작해서, 사람으로 끝나는 하루
      </p>
    </main>
  );
}
