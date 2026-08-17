-- ═══════════════════════════════════════════════════════════════
--  푸시 알림 — 기기 토큰 저장 + 보낼 수 있는 사이인지 판정
-- ═══════════════════════════════════════════════════════════════
-- 발송 자체는 Edge Function(push)이 FCM 으로 한다. 여기는 두 가지만:
--   1. 기기 토큰 저장소 (앱이 로그인 후 자기 토큰을 올린다)
--   2. can_notify() — 아무나 아무에게나 알림을 쏘지 못하게 관계를 검사
--
-- 몇 번 돌려도 안전하다.

-- ───────────────────────────────────────────────────────────────
--  1. 기기 토큰
-- ───────────────────────────────────────────────────────────────
-- 토큰이 PK 다: 같은 폰에서 다른 계정으로 로그인하면 토큰의 주인이
-- 바뀌어야 한다 (안 바꾸면 전 사람 알림이 새 사람 폰에 온다).
create table if not exists push_tokens (
  token      text primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  platform   text not null check (platform in ('ios','android')),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

-- 자기 행만. 남의 토큰이 보이면 그 사람 기기로 직접 쏠 수 있게 된다.
drop policy if exists "push_tokens: own all" on push_tokens;
create policy "push_tokens: own all" on push_tokens
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- upsert 용 — 토큰이 이미 있으면 주인을 바꾼다
create or replace function push_token_save(p_token text, p_platform text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('error','no_auth'); end if;
  if p_platform not in ('ios','android') then
    return json_build_object('error','bad_platform');
  end if;

  insert into push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  return json_build_object('ok', true);
end; $$;

-- 로그아웃할 때 지운다 — 안 지우면 로그아웃한 폰에 알림이 계속 온다
create or replace function push_token_delete(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('error','no_auth'); end if;
  delete from push_tokens where token = p_token and user_id = auth.uid();
  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  2. 보낼 수 있는 사이인가
-- ───────────────────────────────────────────────────────────────
-- Edge Function 이 service role 로 부른다. 클라이언트가 "누구에게" 를
-- 정해서 요청하기 때문에, 서버가 관계를 검사하지 않으면 아무 유저에게나
-- 알림을 쏘는 문을 여는 셈이다.
--
-- 허용: 매칭돼 있거나 / 관심을 주고받았거나 / 같은 모임에 확정돼 있거나.
-- 차단 사이면 무조건 거부.
create or replace function can_notify(p_from uuid, p_to uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_from is not null and p_to is not null
     and p_from <> p_to
     and not exists (
       select 1 from blocks
        where (blocker_id = p_from and blocked_id = p_to)
           or (blocker_id = p_to   and blocked_id = p_from))
     and (
       exists (select 1 from matches
                where (user_a = p_from and user_b = p_to)
                   or (user_a = p_to   and user_b = p_from))
       or exists (select 1 from requests
                   where (from_id = p_from and to_id = p_to)
                      or (from_id = p_to   and to_id = p_from))
       or exists (select 1 from signups a
                   join signups b on b.session_id = a.session_id
                  where a.user_id = p_from and a.status = 'confirmed'
                    and b.user_id = p_to   and b.status = 'confirmed')
     )
$$;

-- ───────────────────────────────────────────────────────────────
--  3. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function push_token_save(text,text)  from public, anon;
revoke execute on function push_token_delete(text)     from public, anon;
-- can_notify 는 Edge Function(service role) 전용. 클라이언트에 열면
-- "저 사람이 나를 차단했나" 를 관계 유무로 역산할 수 있다.
revoke execute on function can_notify(uuid,uuid)       from public, anon, authenticated;

grant execute on function push_token_save(text,text), push_token_delete(text)
to authenticated;
