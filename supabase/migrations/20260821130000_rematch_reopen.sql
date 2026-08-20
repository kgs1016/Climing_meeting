-- ═══════════════════════════════════════════════════════════════
--  재매칭이면 닫힌 방을 다시 연다
-- ═══════════════════════════════════════════════════════════════
-- 1:1 방은 (user_a, user_b) 로 유니크라, 한쪽이 나가서 closed_at 이
-- 찍힌 뒤 다시 관심이 오가 수락되면 request_respond 는 기존 "닫힌 행" 의
-- id 를 돌려준다. closed_at 을 풀지 않으면 — 10크레딧을 쓰고 수락까지
-- 됐는데 채팅방이 어디에도 안 보인다.
--
-- 20260821110000 의 request_respond 를 대체한다 (거절 반환 포함 전체).

create or replace function request_respond(p_request uuid, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare r requests; a uuid; b uuid; mid uuid;
begin
  select * into r from requests where id = p_request for update;
  if not found or r.to_id <> auth.uid() then
    return json_build_object('error','not_allowed');
  end if;
  if r.status <> 'pending' then
    return json_build_object('error','already', 'status', r.status);
  end if;

  update requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_request;

  if not p_accept then
    perform request_fee_refund(p_request);
    return json_build_object('ok', true, 'accepted', false);
  end if;

  -- 수락 → 채팅방 개설 (모임 없이 생긴 매칭이라 session_id 는 NULL)
  a := least(r.from_id, r.to_id);
  b := greatest(r.from_id, r.to_id);

  insert into matches (session_id, user_a, user_b)
  values (null, a, b)
  on conflict do nothing;

  select id into mid from matches
   where session_id is null and user_a = a and user_b = b;

  -- 전에 나가서 닫혀 있던 방이면 다시 연다 — 새로 수락했다는 건
  -- 다시 이야기하겠다는 뜻이다 (지난 대화도 그대로 남아 있다)
  update matches set closed_at = null, closed_by = null
   where id = mid and closed_at is not null;

  return json_build_object('ok', true, 'accepted', true, 'match_id', mid);
end; $$;

revoke execute on function request_respond(uuid,boolean) from public, anon;
grant execute on function request_respond(uuid,boolean) to authenticated;
