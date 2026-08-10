import Link from "next/link";
import type { MyProfile } from "@/lib/myProfile";
import { missingFields } from "@/lib/profileGate";

/* 프로필이 이미 완성된 유저에게는 안 뜬다.
   게이트를 통과한 뒤 나중에 사진을 지우는 등의 경우를 위한 안전망. */
export default function ProfileTodo({ profile }: { profile: MyProfile }) {
  const missing = missingFields(profile);
  if (missing.length === 0) return null;

  return (
    <Link
      href="/profile/new"
      className="block rounded-xl border border-accent/50 bg-accent/10 px-4 py-3"
    >
      <p className="text-[13px] font-bold text-accent">
        프로필에 {missing.join(" · ")}이 빠졌어요
      </p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
        채우기 전에는 사람 찾기에 내 프로필이 안 보여요. 지금 채우기 →
      </p>
    </Link>
  );
}
