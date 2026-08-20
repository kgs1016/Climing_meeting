-- ═══════════════════════════════════════════════════════════════
--  호스트 모임 삭제
-- ═══════════════════════════════════════════════════════════════
-- 지금 호스트는 자기 모임을 지울 방법이 없다 (참가자 취소만 있음).
-- 탈퇴 때와 같은 원칙: 행을 지우지 않고 취소로 표시한다 — 지워버리면
-- 신청자들이 아무 안내 없이 모임을 잃는다.
--
-- 신청비는 waiting·confirmed 전원에게 반환한다. 모임이 사라지는 건
-- 신청자 잘못이 아니다. (이중 반환은 session_fee_refund 가 원장
-- 집계로 막는다 — 20260817130000)

create or replace function session_delete(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; g record; affected uuid[] := '{}';
begin
  select * into s from sessions where id = p_session for update;
  if not found then return json_build_object('error','not_found'); end if;
  if s.host_id is distinct from auth.uid() then
    return json_build_object('error','not_host');
  end if;
  if s.status = 'cancelled' then return json_build_object('ok', true, 'notify', affected); end if;

  for g in
    select user_id from signups
     where session_id = p_session
       and status in ('waiting','confirmed')
       and user_id <> s.host_id
  loop
    perform session_fee_refund(p_session, g.user_id);
    affected := affected || g.user_id;
  end loop;

  update sessions set status = 'cancelled' where id = p_session;

  -- 알림은 클라이언트가 이 목록으로 push 함수를 부른다
  return json_build_object('ok', true, 'notify', affected);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  can_notify 확장 — 호스트 ↔ 신청자
-- ───────────────────────────────────────────────────────────────
-- 기존 규칙(매칭·관심·같은 모임 확정)에는 "호스트와 아직 대기 중인
-- 신청자" 관계가 없다. 그래서 모임 취소·신청 도착 알림이 관계 검사에서
-- 막힌다. 호스트와 신청자(취소되지 않은) 사이를 허용한다.
-- 20260817120000 의 정의를 대체한다 — 차단 검사 포함 전체를 다시 쓴다.
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
       -- 호스트 ↔ 신청자 (대기 포함, 취소 제외)
       or exists (select 1 from sessions s
                   join signups g on g.session_id = s.id
                  where g.status in ('waiting','confirmed')
                    and ((s.host_id = p_from and g.user_id = p_to)
                      or (s.host_id = p_to   and g.user_id = p_from)))
     )
$$;

revoke execute on function session_delete(uuid) from public, anon;
revoke execute on function can_notify(uuid,uuid) from public, anon, authenticated;
grant execute on function session_delete(uuid) to authenticated;
