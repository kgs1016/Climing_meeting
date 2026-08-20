-- ═══════════════════════════════════════════════════════════════
--  관심 채팅 나가기
-- ═══════════════════════════════════════════════════════════════
-- 1:1 방을 정리할 방법이 지금은 "신고하고 차단"뿐이다. 문제는 없는데
-- 그냥 대화를 끝내고 싶은 사람이 차단이라는 센 수단을 쓰게 된다.
--
-- 나가면 방은 양쪽 모두에게서 사라진다 — 한쪽만 남겨두면 상대는
-- 답 없는 방에 계속 말을 걸게 된다. 행과 메시지는 지우지 않는다:
-- 신고가 이 방(ref_id)을 가리킬 수 있어서, 지우면 운영자가 볼 증거가
-- 함께 사라진다.

alter table matches add column if not exists closed_at timestamptz;
alter table matches add column if not exists closed_by uuid
  references profiles(id) on delete set null;

create or replace function chat_leave(p_match uuid)
returns json language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches
   where id = p_match and auth.uid() in (user_a, user_b) for update;
  if not found then return json_build_object('error','not_allowed'); end if;
  if m.closed_at is not null then return json_build_object('ok', true); end if;

  update matches set closed_at = now(), closed_by = auth.uid()
   where id = p_match;

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  닫힌 방을 모든 길에서 뺀다 — 목록 · 읽기 · 쓰기 · 배지
-- ───────────────────────────────────────────────────────────────
-- create or replace 는 통째로 갈아엎는다. 아래 재정의들은 차단 필터
-- (20260815223000 · 20260816233000)를 전부 들고 간 최종본이다.
-- ⚠️ 이후 이 함수들을 고칠 때 closed_at 과 차단 조건을 함께 들고 갈 것.

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
       and m.closed_at is null
       and not blocked_with(p.id)
  ) t;
$$;

-- 목록에서 감추는 것만으로는 부족하다 — 방 id 를 이미 들고 있으면
-- 그대로 들어가진다. 읽기·쓰기에서도 막는다.
create or replace function chat_messages(p_match uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare m matches; other uuid;
begin
  select * into m from matches
   where id = p_match and auth.uid() in (user_a, user_b);
  if not found then return json_build_object('error','not_allowed'); end if;
  if m.closed_at is not null then return json_build_object('error','closed'); end if;

  other := case when m.user_a = auth.uid() then m.user_b else m.user_a end;
  if blocked_with(other) then return json_build_object('error','blocked'); end if;

  return (
    select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]'::json) from (
      select id, sender_id, body, created_at,
             (sender_id = auth.uid()) as mine
        from messages where match_id = p_match
    ) t
  );
end; $$;

create or replace function chat_send(p_match uuid, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare m matches; other uuid;
begin
  if length(trim(coalesce(p_body,''))) = 0 then
    return json_build_object('error','empty');
  end if;

  select * into m from matches
   where id = p_match and auth.uid() in (user_a, user_b);
  if not found then return json_build_object('error','not_allowed'); end if;
  if m.closed_at is not null then return json_build_object('error','closed'); end if;

  other := case when m.user_a = auth.uid() then m.user_b else m.user_a end;
  if blocked_with(other) then return json_build_object('error','blocked'); end if;

  insert into messages (match_id, sender_id, body)
  values (p_match, auth.uid(), trim(p_body));

  return json_build_object('ok', true);
end; $$;

-- 배지도 같이 빼야 한다. 안 그러면 숫자가 떠 있는데 들어가면 방이 없다.
-- 20260816233000 의 정의(차단 + 받은신청·제안 합산)를 그대로 들고 간다.
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
          and m.closed_at is null
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
         and m.closed_at is null
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

revoke execute on function chat_leave(uuid) from public, anon;
grant execute on function chat_leave(uuid) to authenticated;
