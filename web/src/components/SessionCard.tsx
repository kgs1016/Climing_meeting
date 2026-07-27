import Link from "next/link";
import { levelRangeLabel } from "@/lib/levels";
import { slotsLeft, type Session } from "@/lib/mock";

function ageLabel(min: number, max: number) {
  const band = (n: number) => {
    const decade = Math.floor(n / 10) * 10;
    const pos = n % 10 <= 3 ? "초반" : n % 10 <= 6 ? "중반" : "후반";
    return `${decade}대 ${pos}`;
  };
  const a = band(min);
  const b = band(max);
  return a === b ? a : `${a} ~ ${b}`;
}

export default function SessionCard({ session: s }: { session: Session }) {
  const left = slotsLeft(s);
  const full = left.male <= 0 && left.female <= 0;

  return (
    <Link
      href={`/session/${s.id}`}
      className="block rounded-2xl border border-line bg-surface p-4 active:scale-[0.99] transition-transform"
    >
      {/* 짐 · 시간 */}
      <div className="flex items-center justify-between gap-2">
        <p className="font-extrabold text-[15.5px] tracking-tight">
          {s.gym}
          {s.isAway && (
            <span className="ml-1.5 text-[11px] font-bold text-mint align-middle">
              🗺 원정
            </span>
          )}
        </p>
        <p className="text-[13px] text-muted shrink-0">
          {s.date} · {s.start}~{s.end}
        </p>
      </div>

      {/* 레벨 · 나이 */}
      <p className="mt-2 text-[13.5px] text-ink/90">
        {levelRangeLabel(s.levelMin, s.levelMax)}
      </p>
      <p className="mt-0.5 text-[13px] text-muted">{ageLabel(s.ageMin, s.ageMax)}</p>

      {/* 강도 · 뒤풀이 */}
      <p className="mt-1.5 text-[13px] text-muted">
        {s.intensity === "chill" ? "😌 가볍게" : "🔥 빡세게"}
        {s.afterMeal && <span> · 🍽 저녁까지 시간 돼요</span>}
      </p>

      {/* 자리 현황 */}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        {full ? (
          <span className="text-[13px] font-bold text-muted">모집 마감</span>
        ) : (
          <span className="text-[13px] font-semibold">
            {left.male > 0 && <span className="text-male">남 {left.male}자리</span>}
            {left.male > 0 && left.female > 0 && <span className="text-muted"> · </span>}
            {left.female > 0 && (
              <span className="text-female">여 {left.female}자리</span>
            )}
            <span className="text-muted"> 남음</span>
          </span>
        )}
        <span
          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${
            full ? "bg-surface2 text-muted" : "bg-accent text-white"
          }`}
        >
          {full ? "대기 신청" : "참여 신청"}
        </span>
      </div>
    </Link>
  );
}
