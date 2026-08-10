"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProfileTodo from "@/components/ProfileTodo";
import { careerLabel, level } from "@/lib/levels";
import type { MyProfile } from "@/lib/myProfile";
import { loadMyProfile } from "@/lib/myProfile";
import {
  getSupabase,
  hasSupabase,
  currentUser,
  fetchMyProfileDb,
  fetchMyVideos,
} from "@/lib/supabase";

export default function Me() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [videoCount, setVideoCount] = useState(0);
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
      const [prof, vids] = await Promise.all([fetchMyProfileDb(), fetchMyVideos()]);
      setProfile(prof);
      setVideoCount(vids?.length ?? 0);
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
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-[12px] font-semibold text-muted">크레딧</p>
              <p className="mt-1 text-[19px] font-extrabold text-mint">0</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-[12px] font-semibold text-muted">내 영상</p>
              <p className="mt-1 text-[19px] font-extrabold">🎥 {videoCount}</p>
            </div>
          </section>

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
