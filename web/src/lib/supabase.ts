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
  capacity: 1 | 2;
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
  capacity: 1 | 2;
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

/** 확정된 참가자. 모임 목록은 블라인드지만 확정자끼리는 프로필이 열린다. */
export interface RoomPerson {
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
  photo: string | null;
  is_me: boolean;
}

export interface RoomVideo {
  id: string;
  video_url: string;
  created_at: string;
}

export interface Room {
  session: {
    id: string;
    gym: string;
    starts_at: string;
    ends_at: string;
    capacity: 1 | 2;
    intensity: "chill" | "hard";
    after_meal: boolean;
    note: string | null;
  };
  me: { id: string; gender: "m" | "f"; level: LevelId };
  /** 성비 기준 확정 인원 — n:n 의 n */
  matched: number;
  people: RoomPerson[];
  videos: RoomVideo[];
  selection_open: boolean;
}

export type RoomError = "no_profile" | "not_found" | "not_confirmed";

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

/** 영상 경로를 모임에 등록한다 (크레딧은 모임당 1회) */
export async function addSessionVideo(id: string, path: string) {
  const sb = getSupabase();
  if (!sb) return { error: "no_client" };
  const { data, error } = await sb.rpc("session_video_add", {
    p_session: id,
    p_video: path,
  });
  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string; earned?: number; balance?: number };
}

export async function deleteSessionVideo(videoId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.rpc("session_video_delete", { p_video: videoId });
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

/** 경로 규칙: {user_id}/{session_id}/{시각}.{확장자}
 *  첫 폴더가 업로더 uuid 라서 스토리지 정책이 남의 칸 쓰기를 막는다.
 *  한 모임에 여러 개 올릴 수 있어야 하므로 파일명에 시각을 넣는다. */
export async function uploadSessionVideo(
  sessionId: string,
  file: File
): Promise<{ path?: string; error?: string }> {
  const sb = getSupabase();
  const user = await currentUser();
  if (!sb || !user) return { error: "no_auth" };
  if (file.size > VIDEO_MAX_BYTES) return { error: "too_large" };

  const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const path = `${user.id}/${sessionId}/${Date.now()}.${ext}`;

  const { error } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
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
    id: string;
    session_id: string;
    video_url: string;
    created_at: string;
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

/* ── 오픈 전 잠금 · 선착순 ── */

export interface AppFlags {
  sessions_open: boolean;
  people_open: boolean;
  open_at: string | null;
  notice: string | null;
}

/** 로그인 없이도 읽힌다 (플래그·집계뿐) */
export async function fetchAppFlags() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("app_flags");
  if (error) return null;
  return data as AppFlags;
}

export async function fetchEarlyBird() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("early_bird_status");
  if (error) return null;
  return data as { slots: number; taken_m: number; taken_f: number };
}

/* ── 크레딧 ── */

export const CREDIT_LABELS: Record<string, string> = {
  session_video: "🎥 등반 영상",
  profile_complete: "🧗 프로필 완성",
  early_bird: "🎁 사전 가입 혜택",
  request_extra: "💌 관심 보내기",
  // 아래 둘은 로테이션 시절 적립. 지난 원장을 읽으려면 이름이 필요하다.
  mission_video: "🎥 영상 미션",
  mission_done: "✅ 미션 완료",
};

/* 표시용 금액 — 서버 credit_rule() 과 같은 값이어야 한다.
   실제 적립·차감은 전부 서버가 하고, 여기 값은 안내 문구에만 쓴다.
   ⚠️ SQL 의 credit_rule 을 바꾸면 여기도 같이 바꿀 것. */
export const REQUEST_COST = 10; // request_extra
export const CREDIT_SESSION_VIDEO = 2; // session_video (모임당 1회)

export interface Credits {
  balance: number;
  history: { delta: number; reason: string; created_at: string }[];
}

export async function fetchCredits() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_credits");
  if (error) return null;
  return data as Credits;
}

/** 프로필을 처음 완성했을 때 한 번 적립된다 (중복 호출은 서버가 무시) */
export async function claimProfileBonus() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("claim_profile_bonus");
  if (error) return null;
  return data as { ok?: boolean; earned?: number; balance?: number; error?: string };
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
    /** 하루 한도를 넘겨 크레딧으로 보냈는지 */
    spent?: boolean;
    cost?: number;
    balance?: number;
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
