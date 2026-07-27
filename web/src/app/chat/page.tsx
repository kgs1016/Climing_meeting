export default function Chat() {
  return (
    <main className="px-4">
      <header className="pt-6 pb-4">
        <h1 className="text-[19px] font-extrabold tracking-tight">채팅</h1>
      </header>
      <div className="mt-16 flex flex-col items-center gap-2 text-center">
        <span className="text-4xl">💬</span>
        <p className="text-[15px] font-bold">아직 매칭된 상대가 없어요</p>
        <p className="text-[13px] leading-relaxed text-muted">
          모임이 끝나고 서로 선택하면
          <br />
          여기서 대화가 시작돼요
        </p>
      </div>
    </main>
  );
}
