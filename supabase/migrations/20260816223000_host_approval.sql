-- ═══════════════════════════════════════════════════════════════
--  호스트 승인제 — 신청하면 호스트가 받아야 자리가 잡힌다
-- ═══════════════════════════════════════════════════════════════
-- 지금까지는 내 성별 자리가 남아 있으면 신청 즉시 확정이었다. 호스트는
-- 누가 오는지 모른 채 참가자가 정해졌고, 참가자는 확정 전까지 블라인드라
-- 자기 모임에 누가 왔는지 볼 수도 없었다.
--
-- 이제 신청은 전부 대기로 들어가고, 호스트가 받아야 확정된다.
-- 그래서 호스트에게는 신청자 프로필을 연다 — 받을지 말지 정하려면 봐야 한다.
-- 참가자끼리의 블라인드는 그대로다 (확정된 뒤에 서로 보인다).

-- ───────────────────────────────────────────────────────────────
--  1. 신청 — 무조건 대기
-- ───────────────────────────────────────────────────────────────

create or replace function session_join(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; s sessions; confirmed_cnt int;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;

  select * into s from sessions where id = p_session for update;
  if not found or s.status not in ('open','confirmed') then
    return json_build_object('error','not_open');
  end if;
  if s.host_id = me.id then return json_build_object('error','is_host'); end if;

  -- 자리가 이미 다 찼으면 신청 자체를 받지 않는다. 호스트에게 받을 수 없는
  -- 신청을 보내면 거절만 남는다.
  select count(*) into confirmed_cnt from signups
   where session_id = s.id and gender = me.gender and status = 'confirmed';
  if confirmed_cnt >= s.capacity then
    return json_build_object('error','full');
  end if;

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, 'waiting')
  on conflict (session_id, user_id) do update
    -- 취소했다 다시 신청하면 대기부터. 잘린(cut) 사람도 다시 신청할 수 있다.
    set status = case when signups.status in ('cancelled','cut') then 'waiting'
                      else signups.status end;

  return json_build_object(
    'status', (select status from signups where session_id = s.id and user_id = me.id));
end; $$;

-- 취소 — 자동 승격을 없앤다. 자리가 비면 호스트가 다시 고른다.
create or replace function session_cancel(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me_id uuid := auth.uid(); my signups;
begin
  select * into my from signups
   where session_id = p_session and user_id = me_id for update;
  if not found or my.status = 'cancelled' then
    return json_build_object('error','not_joined');
  end if;

  update signups set status = 'cancelled'
   where session_id = p_session and user_id = me_id;

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  2. 호스트가 받거나 거절한다
-- ───────────────────────────────────────────────────────────────

create or replace function session_approve(p_session uuid, p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; g signups; confirmed_cnt int; opened boolean;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id <> auth.uid() then return json_build_object('error','not_host'); end if;

  select * into g from signups
   where session_id = p_session and user_id = p_user;
  if not found or g.status <> 'waiting' then
    return json_build_object('error','not_waiting');
  end if;

  select count(*) into confirmed_cnt from signups
   where session_id = p_session and gender = g.gender and status = 'confirmed';
  if confirmed_cnt >= s.capacity then
    return json_build_object('error','full');
  end if;

  update signups set status = 'confirmed'
   where session_id = p_session and user_id = p_user;

  opened := session_try_confirm(p_session);

  return json_build_object('ok', true, 'chat_opened', opened);
end $$;

create or replace function session_reject(p_session uuid, p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  select * into s from sessions where id = p_session;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id <> auth.uid() then return json_build_object('error','not_host'); end if;

  update signups set status = 'cut'
   where session_id = p_session and user_id = p_user and status = 'waiting';
  if not found then return json_build_object('error','not_waiting'); end if;

  return json_build_object('ok', true);
end $$;

-- ───────────────────────────────────────────────────────────────
--  3. 받은 신청 — 내가 연 모임에 온 사람들
-- ───────────────────────────────────────────────────────────────
-- 호스트는 받을지 정해야 하니 프로필을 본다. 다른 참가자끼리는 여전히
-- 확정 전까지 서로 안 보인다.

create or replace function my_hosted_requests()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json) from (
    select s.id as session_id, s.gym, s.starts_at, s.capacity,
           g.created_at,
           p.id as user_id, p.nickname, p.age, p.gender, p.level, p.career,
           p.height, p.home_gym, p.area, p.mbti, p.intro, p.photo,
           (select count(*) from signups x
             where x.session_id = s.id and x.gender = p.gender
               and x.status = 'confirmed') as same_gender_confirmed
      from signups g
      join sessions s on s.id = g.session_id
      join profiles p on p.id = g.user_id
     where s.host_id = auth.uid()
       and g.status = 'waiting'
       and s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 받은 제안 — 호스트가 걸어둔 조기 확정
-- ───────────────────────────────────────────────────────────────

create or replace function my_confirm_proposals()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.early_confirm_at desc), '[]'::json)
  from (
    select s.id as session_id, s.gym, s.starts_at, s.capacity, s.early_confirm_at,
           h.nickname as host_nickname, h.photo as host_photo,
           least(
             (select count(*) from signups x
               where x.session_id = s.id and x.gender = 'm' and x.status = 'confirmed'),
             (select count(*) from signups x
               where x.session_id = s.id and x.gender = 'f' and x.status = 'confirmed')
           )::int as matched
      from sessions s
      join signups g on g.session_id = s.id
      left join profiles h on h.id = s.host_id
     where g.user_id = auth.uid()
       and g.status = 'confirmed'
       and s.status = 'open'
       and s.host_id <> auth.uid()
       and s.early_confirm_at is not null
       and not exists (select 1 from session_confirm_acks a
                        where a.session_id = s.id and a.user_id = auth.uid())
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  5. 보낸 신청 — 내가 넣은 모임 (상태 포함)
-- ───────────────────────────────────────────────────────────────
-- 호스트가 어떤 사람인지 보여야 기다릴지 말지 판단이 된다.

create or replace function my_signups()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity, s.status as session_status,
           g.status as my_status,
           h.nickname as host_nickname, h.photo as host_photo
      from signups g
      join sessions s on s.id = g.session_id
      left join profiles h on h.id = s.host_id
     where g.user_id = auth.uid()
       and g.status <> 'cancelled'
       and s.host_id <> auth.uid()
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  6. 배지 — 받은 신청 · 받은 제안도 센다
-- ───────────────────────────────────────────────────────────────

create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    -- 신청함 탭 배지 = 내가 답해야 하는 것들의 합
    'requests', (select count(*) from requests
                  where to_id = auth.uid() and status = 'pending')
              + (select count(*) from json_array_elements(my_hosted_requests()))
              + (select count(*) from json_array_elements(my_confirm_proposals())),
    'likes', (select count(*) from requests
               where to_id = auth.uid() and status = 'pending'),
    'hosted', (select count(*) from json_array_elements(my_hosted_requests())),
    'proposals', (select count(*) from json_array_elements(my_confirm_proposals())),
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
--  7. 신청자 사진 읽기
-- ───────────────────────────────────────────────────────────────
-- 호스트는 신청자 얼굴을 봐야 받을지 정한다. 사람 찾기에서 프로필을 내린
-- 사람은 지금 정책으로는 사진이 안 뜬다 — 내 모임의 신청자를 예외로 넣는다.

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
      or exists (
        select 1 from signups g join sessions s on s.id = g.session_id
         where g.user_id::text = (storage.foldername(name))[1]
           and s.host_id = auth.uid()
      )
    )
  );

-- ───────────────────────────────────────────────────────────────
--  8. 권한
-- ───────────────────────────────────────────────────────────────

revoke execute on function session_join(uuid)              from public, anon;
revoke execute on function session_cancel(uuid)            from public, anon;
revoke execute on function session_approve(uuid,uuid)      from public, anon;
revoke execute on function session_reject(uuid,uuid)       from public, anon;
revoke execute on function my_hosted_requests()            from public, anon;
revoke execute on function my_confirm_proposals()          from public, anon;
revoke execute on function my_signups()                    from public, anon;
revoke execute on function inbox_counts()                  from public, anon;

grant execute on function
  session_join(uuid), session_cancel(uuid),
  session_approve(uuid,uuid), session_reject(uuid,uuid),
  my_hosted_requests(), my_confirm_proposals(), my_signups(), inbox_counts()
to authenticated;
