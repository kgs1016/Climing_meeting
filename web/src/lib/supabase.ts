/* Supabase 클라이언트 + 데이터 액세스.
   .env.local 에 키가 없으면 null → 화면은 목데이터로 동작(개발 폴백). */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { CareerId, LevelId } from "./levels";
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

/** 대시보드에서 켜둔 소셜 로그인만 화면에 노출하기 위한 조회 */
export async function enabledOAuthProviders(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    const j = await r.json();
    return Object.entries(j.external ?? {})
      .filter(([k, v]) => v === true && k !== "email" && k !== "phone")
      .map(([k]) => k);
  } catch {
    return [];
  }
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
    careerId: data.career ?? undefined,
    height: data.height ?? undefined,
    homeGym: data.home_gym,
    mbti: data.mbti ?? "",
    intro: data.intro ?? undefined,
    photo: data.photo ?? undefined,
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
    career: p.careerId ?? null,
    height: p.height ?? null,
    home_gym: p.homeGym,
    mbti: p.mbti,
    intro: p.intro ?? null,
    photo: p.photo ?? null,
    is_public: isPublic,
  });
  return { error: error?.message };
}

/* ── 모임 진행 (F 화면) ── */

export interface RoomPartner {
  id: string;
  nickname: string;
  age: number;
  gender: "m" | "f";
  level: LevelId;
  career: CareerId | null;
  height: number | null;
  home_gym: string;
  area: string;
  mbti: string;
  intro: string | null;
}

export interface RoomRound {
  round: number;
  starts_at: string;
  card_open_at: string;
  is_open: boolean;
  /** 라운드가 열리기 전엔 서버가 null 로 내려준다 */
  partner: RoomPartner | null;
  mission_done: boolean;
}

export interface Room {
  session: {
    id: string;
    gym: string;
    starts_at: string;
    ends_at: string;
    capacity: 2 | 3;
    intensity: "chill" | "hard";
    after_meal: boolean;
  };
  me: { id: string; gender: "m" | "f"; level: LevelId; slot: number };
  rounds: RoomRound[];
  warmup_min: number;
  room_ends_at: string;
  selection_open: boolean;
}

export type RoomError =
  | "no_profile"
  | "not_found"
  | "not_confirmed"
  | "not_enough"
  | "overflow";

export async function fetchRoom(
  id: string
): Promise<{ room?: Room; error?: RoomError | string }> {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("session_room", { p_session: id });
  if (error) return { error: error.message };
  const d = data as Room & { error?: string };
  if (d.error) return { error: d.error };
  return { room: d };
}

export async function markMissionDone(id: string, round: number, video?: string) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("mission_done", {
    p_session: id,
    p_round: round,
    p_video: video ?? null,
  });
  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string };
}

export async function submitSelection(id: string, chosen: string[]) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("selection_submit", {
    p_session: id,
    p_chosen: chosen,
  });
  if (error) return { error: error.message };
  return data as { ok?: boolean; count?: number; error?: string };
}

/** 상호선택된 상대만 내려온다. 짝사랑은 서버가 아예 보내지 않는다. */
export async function fetchMatches(id: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_matches", { p_session: id });
  if (error) return null;
  return data as {
    id: string;
    nickname: string;
    age: number;
    level: LevelId;
    career: CareerId | null;
    home_gym: string;
    area: string;
    mbti: string;
    intro: string | null;
  }[];
}

/* ── 미션 영상 (Storage) ── */

const VIDEO_BUCKET = "mission-videos";
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 버킷 설정과 같은 값

/** 경로 규칙: {user_id}/{session_id}/{round}.{확장자}
 *  첫 폴더가 업로더 uuid 라서 스토리지 정책이 남의 칸 쓰기를 막는다. */
export async function uploadMissionVideo(
  sessionId: string,
  round: number,
  file: File
): Promise<{ path?: string; error?: string }> {
  const sb = getSupabase();
  const user = await currentUser();
  if (!sb || !user) return { error: "no_auth" };
  if (file.size > VIDEO_MAX_BYTES) return { error: "too_large" };

  const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const path = `${user.id}/${sessionId}/${round}.${ext}`;

  const { error } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) return { error: error.message };
  return { path };
}

/** 비공개 버킷이라 재생은 서명 URL 로만 된다 (기본 1시간) */
export async function signedVideoUrl(path: string, seconds = 3600) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.storage.from(VIDEO_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function fetchMyVideos() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_videos");
  if (error) return null;
  return data as {
    session_id: string;
    round: number;
    video_url: string;
    gym: string;
    starts_at: string;
  }[];
}

/* ── 채팅 ── */

export interface Chat {
  match_id: string;
  /** 관심 수락으로 생긴 방은 모임이 없어서 null */
  session_id: string | null;
  gym: string | null;
  partner_id: string;
  nickname: string;
  age: number;
  level: LevelId;
  home_gym: string;
  photo: string | null;
  last_body: string | null;
  last_at: string;
  unread: number;
}

export interface ChatMessage {
  id: number;
  sender_id: string;
  body: string;
  created_at: string;
  mine: boolean;
}

export async function fetchChats() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_chats");
  if (error) return null;
  return data as Chat[];
}

export async function fetchChatMessages(matchId: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("chat_messages", { p_match: matchId });
  if (error) return null;
  const d = data as ChatMessage[] | { error: string };
  if (!Array.isArray(d)) return null;
  return d;
}

export async function sendChat(matchId: string, body: string) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("chat_send", {
    p_match: matchId,
    p_body: body,
  });
  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string };
}

/* ── 프로필 사진 ── */

const PHOTO_BUCKET = "profile-photos";
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export async function uploadProfilePhoto(
  file: File
): Promise<{ path?: string; error?: string }> {
  const sb = getSupabase();
  const user = await currentUser();
  if (!sb || !user) return { error: "no_auth" };
  if (file.size > PHOTO_MAX_BYTES) return { error: "too_large" };

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/avatar.${ext}`;
  const { error } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) return { error: error.message };
  return { path };
}

/** 비공개 버킷이라 표시도 서명 URL 로만 된다. 목록은 한 번에 받아온다. */
export async function signedPhotoUrls(
  paths: string[],
  seconds = 3600
): Promise<Record<string, string>> {
  const sb = getSupabase();
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!sb || uniq.length === 0) return {};
  const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(uniq, seconds);
  const out: Record<string, string> = {};
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  }
  return out;
}

/* ── 관심 보내기 ── */

export interface ReceivedRequest {
  id: string;
  message: string | null;
  created_at: string;
  from_id: string;
  nickname: string;
  age: number;
  level: LevelId;
  career: CareerId | null;
  height: number | null;
  home_gym: string;
  area: string;
  mbti: string;
  intro: string | null;
  photo: string | null;
}

export interface SentRequest {
  id: string;
  created_at: string;
  status: "pending" | "accepted";
  to_id: string;
  nickname: string;
  age: number;
  level: LevelId;
  home_gym: string;
}

export async function sendRequest(toId: string, message?: string) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("request_send", {
    p_to: toId,
    p_message: message ?? null,
  });
  if (error) return { error: error.message };
  return data as {
    ok?: boolean;
    left?: number;
    error?: string;
    status?: string;
    limit?: number;
  };
}

export async function fetchReceivedRequests() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("requests_received");
  if (error) return null;
  return data as ReceivedRequest[];
}

export async function fetchSentRequests() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("requests_sent");
  if (error) return null;
  return data as SentRequest[];
}

export async function respondRequest(id: string, accept: boolean) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("request_respond", {
    p_request: id,
    p_accept: accept,
  });
  if (error) return { error: error.message };
  return data as {
    ok?: boolean;
    accepted?: boolean;
    match_id?: string;
    error?: string;
  };
}

export async function fetchInboxCounts() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("inbox_counts");
  if (error) return null;
  return data as {
    requests: number;
    sent_today: number;
    daily_limit: number;
    unread_messages: number;
    unread_rooms: number;
  };
}

/** 방을 열면 호출 — 이 시점 이후 메시지만 안 읽음으로 센다 */
export async function markChatRead(matchId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.rpc("chat_mark_read", { p_match: matchId });
}

/* ── 프로필 목록 ── */

export async function fetchPeople() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("profiles")
    .select(
      "id, nickname, age, gender, level, career, height, home_gym, mbti, area, intro, photo"
    )
    .eq("is_public", true)
    // 사진 없는 카드는 목록에 넣지 않는다 (DB 제약과 이중으로)
    .not("photo", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  return data.map((d) => ({
    id: d.id as string,
    nickname: d.nickname as string,
    age: d.age as number,
    gender: d.gender as "m" | "f",
    level: d.level as LevelId,
    careerId: (d.career ?? undefined) as CareerId | undefined,
    height: (d.height ?? undefined) as number | undefined,
    homeGym: d.home_gym as string,
    mbti: (d.mbti ?? "") as string,
    area: d.area as string,
    intro: (d.intro ?? undefined) as string | undefined,
    photo: (d.photo ?? undefined) as string | undefined,
  }));
}
