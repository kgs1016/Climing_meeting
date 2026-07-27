"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEVELS, type LevelId } from "@/lib/levels";

const GYMS = [
  "더클라임 B홍대",
  "더클라임 연남",
  "더월클라이밍 연남",
  "홍대클라이밍",
  "써미트클라이밍",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13.5px] font-bold">{label}</p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-accent text-white"
          : "border border-line bg-surface text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export default function NewSession() {
  const router = useRouter();
  const [gym, setGym] = useState(GYMS[0]);
  const [capacity, setCapacity] = useState<2 | 3>(2);
  const [levelMin, setLevelMin] = useState<LevelId>(2);
  const [levelMax, setLevelMax] = useState<LevelId>(3);
  const [intensity, setIntensity] = useState<"chill" | "hard">("chill");
  const [afterMeal, setAfterMeal] = useState(false);

  const toggleLevel = (id: LevelId) => {
    // 인접 1단계까지만 허용 — 클릭한 레벨을 포함해 범위 재계산
    if (id < levelMin) {
      if (levelMax - id <= 1) setLevelMin(id);
      else {
        setLevelMin(id);
        setLevelMax((id + 1) as LevelId);
      }
    } else if (id > levelMax) {
      if (id - levelMin <= 1) setLevelMax(id);
      else {
        setLevelMax(id);
        setLevelMin((id - 1) as LevelId);
      }
    } else {
      setLevelMin(id);
      setLevelMax(id);
    }
  };

  return (
    <main className="px-4">
      <header className="flex items-center gap-3 pt-5 pb-4">
        <button onClick={() => router.back()} className="text-lg text-muted">
          ←
        </button>
        <h1 className="text-[19px] font-extrabold tracking-tight">모임 만들기</h1>
      </header>

      <form
        className="flex flex-col gap-6 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          alert("목데이터 단계예요 — Supabase 연결 후 실제로 등록됩니다.");
          router.push("/");
        }}
      >
        <Field label="짐">
          <div className="flex flex-wrap gap-1.5">
            {GYMS.map((g) => (
              <Chip key={g} active={gym === g} onClick={() => setGym(g)}>
                {g}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="날짜 · 시간">
          <div className="grid grid-cols-3 gap-2">
            <input
              type="date"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink [color-scheme:dark]"
            />
            <input
              type="time"
              defaultValue="15:00"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink [color-scheme:dark]"
            />
            <input
              type="time"
              defaultValue="17:00"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink [color-scheme:dark]"
            />
          </div>
          <p className="mt-1.5 text-[12px] text-muted">1.5~2시간을 권장해요</p>
        </Field>

        <Field label="정원">
          <div className="flex gap-1.5">
            <Chip active={capacity === 2} onClick={() => setCapacity(2)}>
              2:2 (4명)
            </Chip>
            <Chip active={capacity === 3} onClick={() => setCapacity(3)}>
              3:3 (6명)
            </Chip>
          </div>
        </Field>

        <Field label="레벨 범위 (인접 1단계까지)">
          <div className="flex gap-1.5">
            {LEVELS.map((l) => (
              <Chip
                key={l.id}
                active={l.id >= levelMin && l.id <= levelMax}
                onClick={() => toggleLevel(l.id)}
              >
                L{l.id}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            {LEVELS.slice(levelMin - 1, levelMax)
              .map((l) => `L${l.id} ${l.name}(${l.colors})`)
              .join(" · ")}
          </p>
        </Field>

        <Field label="나이대">
          <div className="grid grid-cols-2 gap-2">
            <select
              defaultValue="20대 후반부터"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink"
            >
              <option>20대 초반부터</option>
              <option>20대 중반부터</option>
              <option>20대 후반부터</option>
              <option>30대 초반부터</option>
              <option>30대 중반부터</option>
            </select>
            <select
              defaultValue="30대 초반까지"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink"
            >
              <option>20대 후반까지</option>
              <option>30대 초반까지</option>
              <option>30대 중반까지</option>
              <option>30대 후반까지</option>
            </select>
          </div>
        </Field>

        <Field label="강도">
          <div className="flex gap-1.5">
            <Chip active={intensity === "chill"} onClick={() => setIntensity("chill")}>
              😌 가볍게
            </Chip>
            <Chip active={intensity === "hard"} onClick={() => setIntensity("hard")}>
              🔥 빡세게
            </Chip>
          </div>
        </Field>

        <Field label="뒤풀이">
          <div className="flex gap-1.5">
            <Chip active={afterMeal} onClick={() => setAfterMeal(true)}>
              🍽 저녁까지 시간 돼요
            </Chip>
            <Chip active={!afterMeal} onClick={() => setAfterMeal(false)}>
              클라이밍만
            </Chip>
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            약속이 아니라 &ldquo;가능성&rdquo;이에요. 부담 갖지 않아도 돼요
          </p>
        </Field>

        <Field label="한마디 (선택)">
          <input
            placeholder="예: 가볍게 타고 맛있는 거 먹어요"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] text-ink placeholder:text-muted/60"
          />
        </Field>

        <button
          type="submit"
          className="rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white"
        >
          모임 등록하기
        </button>
      </form>
    </main>
  );
}
