import Link from "next/link";
import type { MyProfile } from "@/lib/myProfile";

/* 나중에 필수가 된 항목이 기존 프로필엔 비어 있다.
   프로필을 지워서 다시 만들게 하는 대신, 뭐가 비었는지 알려주고 수정으로 보낸다. */
export function missingFields(p: MyProfile): string[] {
  const missing: string[] = [];
  if (!p.photo) missing.push("대표 사진");
  if (!p.careerId) missing.push("구력");
  return missing;
}

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
        {missing.includes("대표 사진")
          ? "사진이 있으면 관심을 받을 확률이 크게 올라가요. "
          : ""}
        지금 채우기 →
      </p>
    </Link>
  );
}
