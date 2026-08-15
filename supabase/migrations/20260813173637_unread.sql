-- ═══════════════════════════════════════════════════════════════
--  안 읽은 개수 (채팅 · 신청함 배지)
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════

-- 방마다 "언제까지 읽었나" 를 기록한다. 메시지마다 읽음 플래그를 두면
-- 행이 메시지 수만큼 늘어나므로 시점 하나만 남긴다.
create table if not exists chat_reads (
  match_id     uuid not null references matches(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table chat_reads enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.

-- 방을 열면 호출한다
create or replace function chat_mark_read(p_match uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from matches
    where id = p_match and auth.uid() in (user_a, user_b)) then
    return json_build_object('error','not_allowed');
  end if;

  insert into chat_reads (match_id, user_id, last_read_at)
  values (p_match, auth.uid(), now())
  on conflict (match_id, user_id) do update set last_read_at = now();

  return json_build_object('ok', true);
end; $$;

-- 채팅 목록 + 방별 안 읽은 개수
create or replace function my_chats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json) from (
    select m.id as match_id,
           m.session_id,
           s.gym,                      -- 관심 수락으로 생긴 방이면 NULL
           p.id   as partner_id,
           p.nickname,
           p.age,
           p.level,
           p.home_gym,
           p.photo,
           (select body from messages x
             where x.match_id = m.id order by x.created_at desc limit 1) as last_body,
           coalesce(
             (select max(created_at) from messages x where x.match_id = m.id),
             m.created_at) as last_at,
           (select count(*) from messages x
             where x.match_id = m.id
               and x.sender_id <> auth.uid()
               and x.created_at > coalesce(
                     (select r.last_read_at from chat_reads r
                       where r.match_id = m.id and r.user_id = auth.uid()),
                     '-infinity'::timestamptz)) as unread
      from matches m
      left join sessions s on s.id = m.session_id
      join profiles p
        on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
     where auth.uid() in (m.user_a, m.user_b)
  ) t;
$$;

-- 탭 배지용 — 받은 관심 수 + 안 읽은 메시지 수
create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests
                  where to_id = auth.uid() and status = 'pending'),
    'sent_today', (select count(*) from requests
                    where from_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', request_daily_limit(),
    'unread_messages', (
      select count(*)
        from messages x
        join matches m on m.id = x.match_id
       where auth.uid() in (m.user_a, m.user_b)
         and x.sender_id <> auth.uid()
         and x.created_at > coalesce(
               (select r.last_read_at from chat_reads r
                 where r.match_id = m.id and r.user_id = auth.uid()),
               '-infinity'::timestamptz)),
    'unread_rooms', (
      select count(*) from matches m
       where auth.uid() in (m.user_a, m.user_b)
         and exists (
           select 1 from messages x
            where x.match_id = m.id
              and x.sender_id <> auth.uid()
              and x.created_at > coalesce(
                    (select r.last_read_at from chat_reads r
                      where r.match_id = m.id and r.user_id = auth.uid()),
                    '-infinity'::timestamptz)))
  );
$$;

-- ─────────── 권한 ───────────
revoke execute on function chat_mark_read(uuid) from public, anon;
revoke execute on function my_chats()          from public, anon;
revoke execute on function inbox_counts()      from public, anon;

grant execute on function chat_mark_read(uuid), my_chats(), inbox_counts()
to authenticated;
