-- ═══════════════════════════════════════════════════════════════
--  모임 단체 채팅 — 정원이 다 차면 참가자 전원이 한 방에 모인다
-- ═══════════════════════════════════════════════════════════════
-- 지금까지 채팅이 열리는 길은 하나였다. 모임이 끝나갈 무렵 비공개
-- 최종선택에서 서로를 고른 두 사람. 그래서 "몇 시에 만나요", "조금
-- 늦어요" 같은 모임 전 용건을 나눌 곳이 없었다.
--
-- 여기서 두 번째 길을 연다.
--
--   관심 채팅  1:1  ·  관심 수락 · 최종선택 상호매칭   (기존 matches)
--   모임 채팅  단체 ·  호스트가 정한 정원이 다 찬 순간  (여기서 추가)
--
-- 단체방은 따로 테이블을 만들지 않는다. 모임 자체가 방이고, 방 멤버는
-- 그 모임의 확정 참가자다. 방을 또 만들면 참가자 명단이 두 곳에 생겨
-- 어긋난다.

-- ───────────────────────────────────────────────────────────────
--  1. messages — 1:1 방 또는 모임 방, 둘 중 하나에 속한다
-- ───────────────────────────────────────────────────────────────

alter table messages alter column match_id drop not null;
alter table messages add column if not exists session_id uuid
  references sessions(id) on delete cascade;

-- 둘 다 비었거나 둘 다 차 있으면 어느 방 글인지 알 수 없다
alter table messages drop constraint if exists messages_one_room;
alter table messages add constraint messages_one_room check (
  (match_id is not null and session_id is null) or
  (match_id is null and session_id is not null)
);

create index if not exists messages_session_idx on messages (session_id, created_at);

-- 읽은 시점 — 1:1 은 chat_reads, 모임은 여기. match_id 가 not null 인
-- 기존 표를 억지로 넓히는 것보다 표를 나누는 쪽이 제약이 선명하다.
create table if not exists session_chat_reads (
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table session_chat_reads enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만.

-- ───────────────────────────────────────────────────────────────
--  2. 방이 열리는 순간 — 정원이 다 찼을 때
-- ───────────────────────────────────────────────────────────────
-- capacity 는 "성별당" 인원이다 (1 = 1:1, 2 = 2:2).
-- 남녀 확정자가 각각 capacity 에 닿으면 그때 status 를 confirmed 로 옮긴다.
--
-- 한 번 confirmed 가 되면 되돌리지 않는다. 누가 취소해 자리가 비면
-- 신청은 다시 받지만, 이미 열린 대화방까지 닫으면 나눈 말이 사라진다.

create or replace function session_try_confirm(p_session uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare s sessions; m int; f int;
begin
  select * into s from sessions where id = p_session;
  if not found or s.status <> 'open' then return false; end if;

  select count(*) into m from signups
   where session_id = p_session and gender = 'm' and status = 'confirmed';
  select count(*) into f from signups
   where session_id = p_session and gender = 'f' and status = 'confirmed';

  if m < s.capacity or f < s.capacity then return false; end if;

  update sessions set status = 'confirmed' where id = p_session;
  return true;
end $$;

-- 신청이 들어올 때마다 확인한다. session_join 의 나머지 동작은 그대로다.
create or replace function session_join(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; s sessions; confirmed_cnt int; new_status text; opened boolean;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session for update;
  if not found or s.status not in ('open','confirmed') then
    return json_build_object('error','not_open');
  end if;
  if s.host_id = me.id then return json_build_object('error','is_host'); end if;

  select count(*) into confirmed_cnt from signups
   where session_id = s.id and gender = me.gender and status = 'confirmed';

  new_status := case when confirmed_cnt < s.capacity then 'confirmed' else 'waiting' end;

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, new_status)
  on conflict (session_id, user_id) do update
    set status = case when signups.status = 'cancelled' then excluded.status
                      else signups.status end;

  opened := session_try_confirm(s.id);

  return json_build_object(
    'status', (select status from signups where session_id = s.id and user_id = me.id),
    -- 방금 내 신청으로 정원이 찼다 → 화면에서 "모임 채팅이 열렸어요" 를 띄운다
    'chat_opened', opened);
end; $$;

-- 1:1 모임(capacity 1)은 호스트 혼자 만든 순간 이미 절반이 찬 상태다.
-- 이미 만들어져 정원이 찬 모임들도 지금 한 번 확인해 방을 연다.
do $$
declare r record;
begin
  for r in select id from sessions where status = 'open' loop
    perform session_try_confirm(r.id);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────
--  3. 모임 채팅 RPC
-- ───────────────────────────────────────────────────────────────
-- 방에 들어갈 수 있는 사람 = 그 모임의 확정 참가자. 취소하면 빠진다.

create or replace function session_chat_member(p_session uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from signups g join sessions s on s.id = g.session_id
     where g.session_id = p_session
       and g.user_id = auth.uid()
       and g.status = 'confirmed'
       and s.status = 'confirmed')
$$;

create or replace function my_session_chats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json)
  from (
    select s.id as session_id,
           s.gym,
           s.starts_at,
           s.capacity,
           (select count(*) from signups g
             where g.session_id = s.id and g.status = 'confirmed') as members,
           (select body from messages x
             where x.session_id = s.id order by x.created_at desc limit 1) as last_body,
           coalesce(
             (select max(created_at) from messages x where x.session_id = s.id),
             s.created_at) as last_at,
           (select count(*) from messages x
             where x.session_id = s.id
               and x.sender_id <> auth.uid()
               and x.created_at > coalesce(
                     (select r.last_read_at from session_chat_reads r
                       where r.session_id = s.id and r.user_id = auth.uid()),
                     '-infinity'::timestamptz)) as unread
      from sessions s
      join signups g on g.session_id = s.id
     where g.user_id = auth.uid()
       and g.status = 'confirmed'
       and s.status = 'confirmed'
  ) t;
$$;

-- 단체방은 누가 한 말인지 붙어야 읽힌다 (1:1 과 다른 점)
create or replace function session_chat_messages(p_session uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not session_chat_member(p_session) then
    return json_build_object('error','not_allowed');
  end if;

  return (
    select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json) from (
      select x.id, x.sender_id, x.body, x.created_at,
             (x.sender_id = auth.uid()) as mine,
             p.nickname as sender_name,
             p.photo    as sender_photo,
             (x.sender_id = s.host_id) as sender_is_host
        from messages x
        join sessions s on s.id = x.session_id
        left join profiles p on p.id = x.sender_id
       where x.session_id = p_session
    ) t
  );
end $$;

create or replace function session_chat_send(p_session uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_body,''))) = 0 then
    return json_build_object('error','empty');
  end if;
  if not session_chat_member(p_session) then
    return json_build_object('error','not_allowed');
  end if;

  insert into messages (session_id, sender_id, body)
  values (p_session, auth.uid(), trim(p_body));

  return json_build_object('ok', true);
end $$;

create or replace function session_chat_mark_read(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not session_chat_member(p_session) then
    return json_build_object('error','not_allowed');
  end if;

  insert into session_chat_reads (session_id, user_id, last_read_at)
  values (p_session, auth.uid(), now())
  on conflict (session_id, user_id) do update set last_read_at = now();

  return json_build_object('ok', true);
end $$;

-- ───────────────────────────────────────────────────────────────
--  4. 하단 탭 배지 — 모임방 안 읽음도 센다
-- ───────────────────────────────────────────────────────────────

create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests
                  where to_id = auth.uid() and status = 'pending'),
    'sent_today', (select count(*) from requests
                    where from_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', request_daily_limit(),
    'unread_messages',
      (select count(*)
         from messages x
         join matches m on m.id = x.match_id
        where auth.uid() in (m.user_a, m.user_b)
          and x.sender_id <> auth.uid()
          and x.created_at > coalesce(
                (select r.last_read_at from chat_reads r
                  where r.match_id = m.id and r.user_id = auth.uid()),
                '-infinity'::timestamptz))
      +
      (select count(*)
         from messages x
         join signups g on g.session_id = x.session_id and g.user_id = auth.uid()
         join sessions s on s.id = x.session_id
        where g.status = 'confirmed' and s.status = 'confirmed'
          and x.sender_id <> auth.uid()
          and x.created_at > coalesce(
                (select r.last_read_at from session_chat_reads r
                  where r.session_id = s.id and r.user_id = auth.uid()),
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

-- ───────────────────────────────────────────────────────────────
--  5. 같은 모임 사람의 사진 읽기
-- ───────────────────────────────────────────────────────────────
-- 단체방은 말풍선마다 보낸 사람 얼굴이 붙는다. 사진 버킷이 비공개라
-- 서명 URL 을 만들 때 select 권한을 보는데, 지금 정책은 "내 사진 +
-- 사람 찾기 공개(is_public) + 열린 모임의 호스트" 까지만 허용한다.
-- 사람 찾기에서 프로필을 내린 참가자는 얼굴이 안 뜬다.
-- 같은 모임에 함께 확정된 사람을 예외로 넣는다 (진행 화면도 같은 문제였다).

drop policy if exists "profile photos: read public" on storage.objects;
create policy "profile photos: read public" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from profiles
         where profiles.id::text = (storage.foldername(name))[1]
           and profiles.is_public
      )
      or exists (
        select 1 from sessions s
         where s.host_id::text = (storage.foldername(name))[1]
           and s.status in ('open','confirmed')
           and s.starts_at > now() - interval '3 hours'
      )
      or exists (
        select 1
          from signups them
          join signups me on me.session_id = them.session_id
         where them.user_id::text = (storage.foldername(name))[1]
           and them.status = 'confirmed'
           and me.user_id = auth.uid()
           and me.status = 'confirmed'
      )
    )
  );

-- ───────────────────────────────────────────────────────────────
--  6. 권한
-- ───────────────────────────────────────────────────────────────
-- session_try_confirm · session_chat_member 는 다른 함수 안에서만 쓴다
-- (definer 라 호출자 권한이 필요 없다).

revoke execute on function session_try_confirm(uuid)         from public, anon, authenticated;
revoke execute on function session_chat_member(uuid)         from public, anon, authenticated;
revoke execute on function session_join(uuid)                from public, anon;
revoke execute on function my_session_chats()                from public, anon;
revoke execute on function session_chat_messages(uuid)       from public, anon;
revoke execute on function session_chat_send(uuid,text)      from public, anon;
revoke execute on function session_chat_mark_read(uuid)      from public, anon;
revoke execute on function inbox_counts()                    from public, anon;

grant execute on function
  session_join(uuid), my_session_chats(), session_chat_messages(uuid),
  session_chat_send(uuid,text), session_chat_mark_read(uuid), inbox_counts()
to authenticated;
