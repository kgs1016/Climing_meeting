import { level } from "@/lib/levels";

export default function Me() {
  const my = { nickname: "경수", level: 3 as const, homeGym: "더클라임 연남", credits: 40 };

  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">내 정보</h1>
      </header>

      <section className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-2xl">
          🧗
        </div>
        <div>
          <p className="text-[17px] font-extrabold">{my.nickname}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            L{my.level} {level(my.level).name} ({level(my.level).colors}) ·{" "}
            {my.homeGym}
          </p>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold text-muted">크레딧</p>
          <p className="mt-1 text-[19px] font-extrabold text-mint">
            {my.credits}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold text-muted">내 영상</p>
          <p className="mt-1 text-[19px] font-extrabold">🎥 0</p>
        </div>
      </section>

      <section className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        {[
          "프로필 · 취향 설문 수정",
          "레벨 변경",
          "내 영상 보관함",
          "참여 이력",
          "안전 설정 (신고·차단)",
        ].map((item) => (
          <button
            key={item}
            className="flex items-center justify-between border-b border-line px-4 py-3.5 text-left text-[14px] font-semibold last:border-b-0"
          >
            {item}
            <span className="text-muted">›</span>
          </button>
        ))}
      </section>

      <p className="mt-6 text-center text-[11.5px] text-muted">
        HOBIDAY — 취미로 시작해서, 사람으로 끝나는 하루
      </p>
    </main>
  );
}
