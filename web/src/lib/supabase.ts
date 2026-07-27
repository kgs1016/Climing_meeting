/* Supabase 클라이언트 + 데이터 액세스.
   .env.local 에 키가 없으면 null → 화면은 목데이터로 동작(개발 폴백). */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { LevelId } from "./levels";
import type { Session } from "./mock";
import type { MyProfile } from "./myProfile";

let _client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _client = url && key ? createClient(url, key) : null;
  return _client;
}

export const hasSupabase = () => getSupabase() !== null;

export async function currentUser(): Promise<User | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/* ── DB 행 → 화면 타입 변환 ── */

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export interface DbSession {
  id: string;
  gym: string;
  starts_at: string;
  ends_at: string;
  capacity: 2 | 3;
  level_min: LevelId;
  level_max: LevelId;
  age_min: number;
  age_max: number;
  intensity: "chill" | "hard";
  after_meal: boolean;
  note: string | null;
  status: string;
  m_confirmed: number;
  f_confirmed: number;
  my_status: string | null;
}

export function toSession(r: DbSession, myHomeGym?: string): Session & { myStatus: string | null } {
  const st = new Date(r.starts_at);
  const en = new Date(r.ends_at);
  const hm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    id: r.id,
    gym: r.gym,
    date: `${DAYS[st.getDay()]} ${st.getMonth() + 1}/${st.getDate()}`,
    start: hm(st),
    end: hm(en),
    capacity: r.capacity,
    levelMin: r.level_min,
    levelMax: r.level_max,
    ageMin: r.age_min,
    ageMax: r.age_max,
    intensity: r.intensity,
    afterMeal: r.after_meal,
    note: r.note ?? undefined,
    maleJoined: Number(r.m_confirmed),
    femaleJoined: Number(r.f_confirmed),
    status: r.status === "open" ? "open" : "confirmed",
    isAway: myHomeGym ? r.gym !== myHomeGym : false,
    myStatus: r.my_status,
  };
}

/* ── 세션 ── */

export async function fetchSessions(): Promise<DbSession[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("session_list");
  if (error) {
    console.error("session_list", error);
    return null;
  }
  return data as DbSession[];
}

export async function createSession(p: {
  gym: string;
  startsAt: string; // ISO
  endsAt: string;
  capacity: 2 | 3;
  levelMin: LevelId;
  levelMax: LevelId;
  ageMin: number;
  ageMax: number;
  intensity: "chill" | "hard";
  afterMeal: boolean;
  note: string;
}): Promise<{ id?: string; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("session_create", {
    p_gym: p.gym,
    p_starts_at: p.startsAt,
    p_ends_at: p.endsAt,
    p_capacity: p.capacity,
    p_level_min: p.levelMin,
    p_level_max: p.levelMax,
    p_age_min: p.ageMin,
    p_age_max: p.ageMax,
    p_intensity: p.intensity,
    p_after_meal: p.afterMeal,
    p_note: p.note,
  });
  if (error) return { error: error.message };
  return data as { id?: string; error?: string };
}

export async function joinSession(id: string) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("session_join", { p_session: id });
  if (error) return { error: error.message };
  return data as { status?: string; error?: string };
}

export async function fetchMySignups() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_signups");
  if (error) return null;
  return data as {
    id: string;
    gym: string;
    starts_at: string;
    my_status: string;
  }[];
}

/* ── 프로필 ── */

export async function fetchMyProfileDb(): Promise<(MyProfile & { isPublic: boolean }) | null> {
  const sb = getSupabase();
  const user = await currentUser();
  if (!sb || !user) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data) return null;
  return {
    nickname: data.nickname,
    gender: data.gender,
    age: data.age,
    area: data.area,
    level: data.level,
    homeGym: data.home_gym,
    mbti: data.mbti ?? "",
    intro: data.intro ?? undefined,
    isPublic: data.is_public,
  };
}

export async function upsertMyProfileDb(p: MyProfile, isPublic: boolean) {
  const sb = getSupabase();
  const user = await currentUser();
  if (!sb || !user) return { error: "no_auth" };
  const { error } = await sb.from("profiles").upsert({
    id: user.id,
    nickname: p.nickname,
    gender: p.gender,
    age: p.age,
    area: p.area,
    level: p.level,
    home_gym: p.homeGym,
    mbti: p.mbti,
    intro: p.intro ?? null,
    is_public: isPublic,
  });
  return { error: error?.message };
}

export async function fetchPeople() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("id, nickname, age, gender, level, home_gym, mbti, area, intro")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  return data.map((d) => ({
    id: d.id as string,
    nickname: d.nickname as string,
    age: d.age as number,
    gender: d.gender as "m" | "f",
    level: d.level as LevelId,
    homeGym: d.home_gym as string,
    mbti: (d.mbti ?? "") as string,
    area: d.area as string,
    intro: (d.intro ?? undefined) as string | undefined,
  }));
}
