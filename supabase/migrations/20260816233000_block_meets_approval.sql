-- ═══════════════════════════════════════════════════════════════
--  차단과 새 기능을 한 자리에서 합친다
-- ═══════════════════════════════════════════════════════════════
-- 20260815223000_report_block 이 session_list · session_join · inbox_counts
-- 에 차단 필터를 넣었는데, 그보다 뒤에 온 마이그레이션들이 같은 함수를
-- 다시 정의하면서 그 필터를 지워버렸다. create or replace 는 통째로 갈아엎기
-- 때문이다.
--
-- 여기서 최종본을 한 번에 쓴다. 차단 필터 + 호스트 정보 + 조기 확정 +
-- 호스트 승인제가 모두 들어간 버전이다.
--
-- 이후로 이 함수들을 고칠 때는 반드시 차단 조건을 함께 들고 가야 한다.

-- ───────────────────────────────────────────────────────────────
--  1. 모임 목록
-- ───────────────────────────────────────────────────────────────
-- 차단한 사람이 확정돼 있는 모임은 감춘다. "참여 불가" 라고만 띄우면
-- 그 사람이 어느 짐 어느 시간에 있는지가 역으로 드러난다.

create or replace function session_list()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.starts_at), '[]'::json) from (
    select s.id, s.gym, s.starts_at, s.ends_at, s.capacity,
           s.level_min, s.level_max, s.age_min, s.age_max,
           s.intensity, s.after_meal, s.note, s.status,
           s.host_id,
           h.nickname as host_nickname,
           h.photo    as host_photo,
           h.age      as host_age,
           h.area     as host_area,
           h.level    as host_level,
           (s.host_id = auth.uid()) as i_am_host,
           s.early_confirm_at,
           exists (select 1 from session_confirm_acks a
                    where a.session_id = s.id and a.user_id = auth.uid()) as my_ack,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'm' and g.status = 'confirmed') as m_confirmed,
           (select count(*) from signups g
             where g.session_id = s.id and g.gender = 'f' and g.status = 'confirmed') as f_confirmed,
           (select g.status from signups g
             where g.session_id = s.id and g.user_id = auth.uid()) as my_status
      from sessions s
      left join profiles h on h.id = s.host_id
     where s.status in ('open','confirmed')
       and s.starts_at > now() - interval '3 hours'
       -- 호스트를 차단했으면 그 모임 자체가 안 보인다
       and (s.host_id is null or not blocked_with(s.host_id))
       and not exists (
         select 1 from signups g
          where g.session_id = s.id and g.status = 'confirmed'
            and blocked_with(g.user_id))
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  2. 신청 — 호스트 승인제 + 차단
-- ───────────────────────────────────────────────────────────────
-- 목록에서 감춰도 id 를 들고 있으면 신청은 된다. 여기서도 막는다.

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

  if (s.host_id is not null and blocked_with(s.host_id))
     or exists (select 1 from signups g
                 where g.session_id = s.id and g.status = 'confirmed'
                   and blocked_with(g.user_id)) then
    return json_build_object('error','blocked');
  end if;

  -- 자리가 이미 다 찼으면 신청 자체를 받지 않는다
  select count(*) into confirmed_cnt from signups
   where session_id = s.id and gender = me.gender and status = 'confirmed';
  if confirmed_cnt >= s.capacity then
    return json_build_object('error','full');
  end if;

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, 'waiting')
  on conflict (session_id, user_id) do update
    set status = case when signups.status in ('cancelled','cut') then 'waiting'
                      else signups.status end;

  return json_build_object(
    'status', (select status from signups where session_id = s.id and user_id = me.id));
end; $$;

-- 호스트도 차단한 사람은 받을 수 없다
create or replace function session_approve(p_session uuid, p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; g signups; confirmed_cnt int; opened boolean;
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id <> auth.uid() then return json_build_object('error','not_host'); end if;
  if blocked_with(p_user) then return json_build_object('error','blocked'); end if;

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

-- ───────────────────────────────────────────────────────────────
--  3. 신청함 목록들
-- ───────────────────────────────────────────────────────────────

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
       and not blocked_with(p.id)
  ) t;
$$;

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
       and (s.host_id is null or not blocked_with(s.host_id))
       and not exists (select 1 from session_confirm_acks a
                        where a.session_id = s.id and a.user_id = auth.uid())
  ) t;
$$;

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
       and (s.host_id is null or not blocked_with(s.host_id))
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  4. 모임 단체 채팅
-- ───────────────────────────────────────────────────────────────
-- 차단한 사람이 있는 모임은 목록에서 감춘 것과 같은 이유로 방도 닫는다.
-- 차단해놓고 같은 방에서 계속 마주치면 차단이 아니다.

create or replace function session_chat_member(p_session uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from signups g join sessions s on s.id = g.session_id
     where g.session_id = p_session
       and g.user_id = auth.uid()
       and g.status = 'confirmed'
       and s.status = 'confirmed')
   and not exists (
    select 1 from signups b
     where b.session_id = p_session and b.status = 'confirmed'
       and blocked_with(b.user_id))
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
       and not exists (
         select 1 from signups b
          where b.session_id = s.id and b.status = 'confirmed'
            and blocked_with(b.user_id))
  ) t;
$$;

-- ───────────────────────────────────────────────────────────────
--  5. 배지
-- ───────────────────────────────────────────────────────────────

create or replace function inbox_counts()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'requests', (select count(*) from requests r
                  where r.to_id = auth.uid() and r.status = 'pending'
                    and not blocked_with(r.from_id))
              + (select count(*) from json_array_elements(my_hosted_requests()))
              + (select count(*) from json_array_elements(my_confirm_proposals())),
    'likes', (select count(*) from requests r
               where r.to_id = auth.uid() and r.status = 'pending'
                 and not blocked_with(r.from_id)),
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
          and not blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
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
          and not exists (
            select 1 from signups b
             where b.session_id = s.id and b.status = 'confirmed'
               and blocked_with(b.user_id))
          and x.created_at > coalesce(
                (select r.last_read_at from session_chat_reads r
                  where r.session_id = s.id and r.user_id = auth.uid()),
                '-infinity'::timestamptz)),
    'unread_rooms', (
      select count(*) from matches m
       where auth.uid() in (m.user_a, m.user_b)
         and not blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
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
--  6. 권한
-- ───────────────────────────────────────────────────────────────

revoke execute on function session_list()             from public, anon;
revoke execute on function session_join(uuid)         from public, anon;
revoke execute on function session_approve(uuid,uuid) from public, anon;
revoke execute on function my_hosted_requests()       from public, anon;
revoke execute on function my_confirm_proposals()     from public, anon;
revoke execute on function my_signups()               from public, anon;
revoke execute on function my_session_chats()         from public, anon;
revoke execute on function inbox_counts()             from public, anon;
revoke execute on function session_chat_member(uuid)  from public, anon, authenticated;

grant execute on function
  session_list(), session_join(uuid), session_approve(uuid,uuid),
  my_hosted_requests(), my_confirm_proposals(), my_signups(),
  my_session_chats(), inbox_counts()
to authenticated;
