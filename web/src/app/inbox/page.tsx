const MOCK = [
  {
    id: "a1",
    title: "더클라임 B홍대 · 토 8/1 15:00",
    status: "confirmed" as const,
  },
  {
    id: "a2",
    title: "홍대클라이밍 · 토 8/1 19:00",
    status: "cut" as const,
  },
];

const STATUS = {
  waiting: { label: "대기 중", cls: "bg-surface2 text-muted" },
  confirmed: { label: "확정", cls: "bg-mint/15 text-mint" },
  cut: { label: "다음 순번 · 우선권 보유", cls: "bg-accent/15 text-accent-soft" },
};

export default function Inbox() {
  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">신청함</h1>
      </header>

      <div className="flex flex-col gap-3">
        {MOCK.map((a) => (
          <div
            key={a.id}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-bold">{a.title}</p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS[a.status].cls}`}
              >
                {STATUS[a.status].label}
              </span>
            </div>
            {a.status === "cut" && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                이번 모임은 성비 조정으로 다음 순번이 됐어요. 다음 모임 신청 시{" "}
                <b className="text-ink">우선 확정</b>됩니다.
              </p>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
