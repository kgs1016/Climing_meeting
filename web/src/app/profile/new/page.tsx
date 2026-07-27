"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LEVELS, type LevelId } from "@/lib/levels";
import {
  loadMyProfile,
  saveMyProfile,
  removeMyProfile,
} from "@/lib/myProfile";

const MBTI = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
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

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] text-ink placeholder:text-muted/60";

export default function ProfileNew() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState<"m" | "f">("f");
  const [age, setAge] = useState("");
  const [area, setArea] = useState("");
  const [level, setLevel] = useState<LevelId>(2);
  const [homeGym, setHomeGym] = useState("");
  const [mbti, setMbti] = useState("");
  const [intro, setIntro] = useState("");

  useEffect(() => {
    const p = loadMyProfile();
    if (!p) return;
    setEditing(true);
    setNickname(p.nickname);
    setGender(p.gender);
    setAge(String(p.age));
    setArea(p.area);
    setLevel(p.level);
    setHomeGym(p.homeGym);
    setMbti(p.mbti);
    setIntro(p.intro ?? "");
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(age);
    if (!nickname.trim()) return alert("닉네임을 입력해주세요");
    if (!n || n < 19 || n > 60) return alert("나이를 확인해주세요");
    if (!area.trim()) return alert("사는 동네를 입력해주세요");
    if (!homeGym.trim()) return alert("홈짐을 입력해주세요");
    if (!mbti) return alert("MBTI를 선택해주세요");

    saveMyProfile({
      nickname: nickname.trim(),
      gender,
      age: n,
      area: area.trim(),
      level,
      homeGym: homeGym.trim(),
      mbti,
      intro: intro.trim() || undefined,
    });
    router.push("/#people");
  };

  const takeDown = () => {
    if (!confirm("사람 찾기 목록에서 내 프로필을 내릴까요?")) return;
    removeMyProfile();
    router.push("/#people");
  };

  return (
    <main className="px-4">
      <header className="flex items-center gap-3 pt-5 pb-4">
        <button onClick={() => router.back()} className="text-lg text-muted">
          ←
        </button>
        <h1 className="text-[19px] font-extrabold tracking-tight">
          {editing ? "내 프로필 수정" : "내 프로필 올리기"}
        </h1>
      </header>

      <p className="mb-5 rounded-xl border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        여기 올린 프로필은 <b className="text-ink">사람 찾기 목록에 공개</b>돼요.
        모임 참여는 블라인드라 프로필이 공개되지 않아요.
        <br />
        📷 사진 등록은 다음 업데이트에서 열려요.
      </p>

      <form className="flex flex-col gap-6 pb-8" onSubmit={submit}>
        <Field label="닉네임">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 서연"
            className={inputCls}
          />
        </Field>

        <Field label="성별">
          <div className="flex gap-1.5">
            <Chip active={gender === "f"} onClick={() => setGender("f")}>
              여성
            </Chip>
            <Chip active={gender === "m"} onClick={() => setGender("m")}>
              남성
            </Chip>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="나이">
            <input
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="예: 27"
              className={inputCls}
            />
          </Field>
          <Field label="사는 동네">
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="예: 연남동"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="레벨 (편하게 완등하는 수준)">
          <div className="flex gap-1.5">
            {LEVELS.map((l) => (
              <Chip
                key={l.id}
                active={level === l.id}
                onClick={() => setLevel(l.id)}
              >
                L{l.id}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            L{level} {LEVELS[level - 1].name} — 더클라임 기준{" "}
            {LEVELS[level - 1].colors} ({LEVELS[level - 1].vgrade})
          </p>
        </Field>

        <Field label="홈짐">
          <input
            value={homeGym}
            onChange={(e) => setHomeGym(e.target.value)}
            placeholder="예: 더클라임 연남"
            className={inputCls}
          />
        </Field>

        <Field label="MBTI">
          <select
            value={mbti}
            onChange={(e) => setMbti(e.target.value)}
            className={inputCls}
          >
            <option value="">선택해주세요</option>
            {MBTI.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>

        <Field label="한마디 (선택)">
          <input
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder="예: 주말 오후에 주로 타요. 같이 문제 풀어요!"
            className={inputCls}
          />
        </Field>

        <button
          type="submit"
          className="rounded-xl bg-accent py-3.5 text-[15px] font-bold text-white"
        >
          {editing ? "수정 완료" : "프로필 올리기"}
        </button>

        {editing && (
          <button
            type="button"
            onClick={takeDown}
            className="rounded-xl border border-line py-3 text-[14px] font-bold text-muted"
          >
            프로필 내리기
          </button>
        )}
      </form>
    </main>
  );
}
