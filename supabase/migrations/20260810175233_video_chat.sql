-- ═══════════════════════════════════════════════════════════════
--  영상 업로드(Storage) + 채팅
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  1. 영상 스토리지
-- ───────────────────────────────────────────────────────────────
-- 비공개 버킷. 실명에 가까운 개인 영상이라 절대 public 으로 두지 않는다.
-- 재생은 signed URL 로만 한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mission-videos', 'mission-videos', false, 52428800, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/mp4','video/quicktime','video/webm'];

-- 경로 규칙: {user_id}/{session_id}/{round}.{확장자}
-- 첫 폴더가 업로더 uuid 라서, 그것만 검사하면 남의 칸에 못 쓴다.
drop policy if exists "mission videos: own insert" on storage.objects;
create policy "mission videos: own insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "mission videos: own read" on storage.objects;
create policy "mission videos: own read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "mission videos: own update" on storage.objects;
create policy "mission videos: own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'mission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "mission videos: own delete" on storage.objects;
create policy "mission videos: own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mission-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 내 영상 보관함 — 참여한 모임의 내 영상 목록
create or replace function my_videos()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at desc, t.round), '[]'::json) from (
    select m.session_id, m.round, m.video_url, s.gym, s.starts_at
      from missions m join sessions s on s.id = m.session_id
     where m.user_id = auth.uid() and m.video_url is not null
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  2. 채팅
-- ───────────────────────────────────────────────────────────────
-- 상호선택이 성립한 쌍마다 방이 하나 생긴다.
-- user_a < user_b 로 정렬해 저장하므로 같은 쌍이 중복 생성되지 않는다.
create table if not exists matches (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_a     uuid not null references profiles(id) on delete cascade,
  user_b     uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (session_id, user_a, user_b),
  check (user_a < user_b)
);

create table if not exists messages (
  id         bigserial primary key,
  match_id   uuid not null references matches(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz default now()
);

create index if not exists messages_match_idx on messages (match_id, created_at);

alter table matches  enable row level security;
alter table messages enable row level security;
-- 정책 없음 = 직접 접근 차단. 아래 RPC 로만 접근한다.

-- 상호선택이 성립했으면 방을 만든다 (selection_submit 이 호출)
create or replace function sync_matches(p_session uuid)
returns int language plpgsql security definer set search_path = public as $$
declare made int := 0;
begin
  insert into matches (session_id, user_a, user_b)
  select distinct a.session_id,
         least(a.chooser_id, a.chosen_id),
         greatest(a.chooser_id, a.chosen_id)
    from selections a
    join selections b
      on b.session_id = a.session_id
     and b.chooser_id = a.chosen_id
     and b.chosen_id  = a.chooser_id
   where a.session_id = p_session
  on conflict (session_id, user_a, user_b) do nothing;

  get diagnostics made = row_count;
  return made;
end; $$;

-- 내 채팅 목록 (상대 · 마지막 메시지)
create or replace function my_chats()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.last_at desc nulls last), '[]'::json) from (
    select m.id as match_id,
           m.session_id,
           s.gym,
           p.id   as partner_id,
           p.nickname,
           p.age,
           p.level,
           p.home_gym,
           (select body from messages x
             where x.match_id = m.id order by x.created_at desc limit 1) as last_body,
           coalesce(
             (select max(created_at) from messages x where x.match_id = m.id),
             m.created_at) as last_at
      from matches m
      join sessions s on s.id = m.session_id
      join profiles p
        on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
     where auth.uid() in (m.user_a, m.user_b)
  ) t;
$$;

-- 대화 내용
create or replace function chat_messages(p_match uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (select 1 from matches
    where id = p_match and auth.uid() in (user_a, user_b)) into ok;
  if not ok then return json_build_object('error','not_allowed'); end if;

  return (
    select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json) from (
      select id, sender_id, body, created_at,
             (sender_id = auth.uid()) as mine
        from messages where match_id = p_match
    ) t
  );
end; $$;

-- 메시지 보내기
create or replace function chat_send(p_match uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if length(trim(coalesce(p_body,''))) = 0 then
    return json_build_object('error','empty');
  end if;

  select exists (select 1 from matches
    where id = p_match and auth.uid() in (user_a, user_b)) into ok;
  if not ok then return json_build_object('error','not_allowed'); end if;

  insert into messages (match_id, sender_id, body)
  values (p_match, auth.uid(), trim(p_body));

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. selection_submit 갱신 — 제출할 때 방까지 만든다
-- ───────────────────────────────────────────────────────────────
create or replace function selection_submit(p_session uuid, p_chosen uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; valid uuid[];
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  if not exists (select 1 from signups
    where session_id = p_session and user_id = me.id and status = 'confirmed') then
    return json_build_object('error','not_confirmed');
  end if;

  select coalesce(array_agg(g.user_id), '{}') into valid
    from signups g
   where g.session_id = p_session and g.status = 'confirmed'
     and g.gender <> me.gender
     and g.user_id = any(p_chosen);

  delete from selections where session_id = p_session and chooser_id = me.id;

  if array_length(valid, 1) is not null then
    insert into selections (session_id, chooser_id, chosen_id)
    select p_session, me.id, unnest(valid);
  end if;

  -- 상호선택이 생겼으면 채팅방 개설
  perform sync_matches(p_session);

  return json_build_object('ok', true, 'count', coalesce(array_length(valid,1), 0));
end; $$;

-- ───────────────────────────────────────────────────────────────
--  4. 권한 — PUBLIC 기본 EXECUTE 를 반드시 함께 회수한다
-- ───────────────────────────────────────────────────────────────
revoke execute on function my_videos()                   from public, anon;
revoke execute on function sync_matches(uuid)            from public, anon;
revoke execute on function my_chats()                    from public, anon;
revoke execute on function chat_messages(uuid)           from public, anon;
revoke execute on function chat_send(uuid,text)          from public, anon;
revoke execute on function selection_submit(uuid,uuid[]) from public, anon;

grant execute on function
  my_videos(), my_chats(), chat_messages(uuid), chat_send(uuid,text),
  selection_submit(uuid,uuid[])
to authenticated;

-- sync_matches 는 selection_submit 내부에서만 쓴다 (definer 라 호출자 권한 불필요)
