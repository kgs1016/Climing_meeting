-- ═══════════════════════════════════════════════════════════════
--  모임 신청 유료화 — 신청 시 10크레딧, 안 되면 반환
-- ═══════════════════════════════════════════════════════════════
-- 크레딧은 관심·모임 통합이다 (2026-08-17 확정). 호스트가 모임을 여는 건
-- 무료 — 모임 공급이 늘어야 앱이 돈다.
--
-- 차감·반환 규칙 (상태 전이가 곧 과금 규칙이다):
--   차감:  없음/cancelled/cut → waiting   (신청·재신청)
--   반환:  waiting → cut                  (호스트 거절)
--          waiting → cancelled            (확정 전 본인 취소)
--          모임 소멸 (호스트 탈퇴)         (waiting·confirmed 모두)
--   반환 없음: confirmed 후 본인 취소     (수락된 자리를 비우는 비용)
--
-- 반환은 "낸 것보다 많이 돌려주지 않는다" 를 원장 집계로 보장한다 —
-- 공짜였던 시절(이 마이그레이션 전)의 신청은 차감 기록이 없으므로
-- 거절돼도 반환이 생기지 않는다.
--
-- ⚠️ session_join · session_reject · session_cancel · account_delete 를
--    다시 정의한다. 이후 이 함수들을 고칠 때는 차감·반환 로직을 반드시
--    함께 들고 갈 것 (create or replace 는 통째로 갈아엎는다).

-- ───────────────────────────────────────────────────────────────
--  1. 금액 규칙 — 기존 값 전부 + 모임 신청
-- ───────────────────────────────────────────────────────────────
create or replace function credit_rule(p_reason text) returns int
  language sql immutable as $$
  select case p_reason
    when 'early_bird'       then 100
    when 'profile_complete' then 30
    when 'session_video'    then 2
    when 'request_extra'    then -10  -- 관심 1회
    when 'session_join'     then -10  -- 모임 신청 1회
    when 'session_refund'   then 10   -- 모임 신청 반환
    when 'mission_video'    then 0
    when 'mission_done'     then 0
    else 0
  end $$;

revoke execute on function credit_rule(text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────
--  2. 반환 — 낸 만큼만, 한 번씩만
-- ───────────────────────────────────────────────────────────────
-- 차감 횟수 > 반환 횟수일 때만 돌려준다. 어떤 경로(거절·취소·모임 소멸)로
-- 몇 번을 불러도 이 집계가 이중 반환을 막는다.
create or replace function session_fee_refund(p_session uuid, p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare charged int; refunded int; amt int;
begin
  select count(*), coalesce(-min(delta), 0) into charged, amt
    from credit_ledger
   where user_id = p_user and reason = 'session_join'
     and ref like p_session::text || ':%';
  if charged = 0 then return 0; end if;   -- 공짜 시절의 신청

  select count(*) into refunded
    from credit_ledger
   where user_id = p_user and reason = 'session_refund'
     and ref like p_session::text || ':%';
  if refunded >= charged then return 0; end if;

  insert into credit_ledger (user_id, delta, reason, ref)
  values (p_user, amt, 'session_refund',
          p_session::text || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint::text);
  return amt;
end; $$;

-- ───────────────────────────────────────────────────────────────
--  3. 신청 — 차감을 붙인다 (검사 전부 통과한 뒤에만)
-- ───────────────────────────────────────────────────────────────
create or replace function session_join(p_session uuid)
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; s sessions; confirmed_cnt int; existing signups;
        cost int := -credit_rule('session_join'); bal int;
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

  -- 이미 신청 중이면 차감 없이 상태만 돌려준다
  select * into existing from signups
   where session_id = s.id and user_id = me.id;
  if found and existing.status in ('waiting','confirmed') then
    return json_build_object('status', existing.status);
  end if;

  -- 같은 유저의 동시 요청이 잔액을 함께 넘기지 못하게 잠근다
  perform pg_advisory_xact_lock(hashtext(me.id::text));

  bal := credit_balance(me.id);
  if bal < cost then
    return json_build_object('error','no_credits', 'cost', cost, 'balance', bal);
  end if;

  -- ref 를 매번 다르게 둬야 취소 후 재신청 때 다시 차감된다
  insert into credit_ledger (user_id, delta, reason, ref)
  values (me.id, -cost, 'session_join',
          s.id::text || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint::text);

  insert into signups (session_id, user_id, gender, status)
  values (s.id, me.id, me.gender, 'waiting')
  on conflict (session_id, user_id) do update
    set status = case when signups.status in ('cancelled','cut') then 'waiting'
                      else signups.status end;

  return json_build_object(
    'status', (select status from signups where session_id = s.id and user_id = me.id),
    'cost', cost, 'balance', credit_balance(me.id));
end; $$;

-- ───────────────────────────────────────────────────────────────
--  4. 거절 — 반환을 붙인다
-- ───────────────────────────────────────────────────────────────
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

  -- 거절당한 사람 잘못이 아니다 — 신청비를 돌려준다
  perform session_fee_refund(p_session, p_user);

  return json_build_object('ok', true);
end $$;

-- ───────────────────────────────────────────────────────────────
--  5. 본인 취소 — 확정 전이면 반환
-- ───────────────────────────────────────────────────────────────
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

  -- 대기 중 취소는 반환. 확정 후 취소는 반환 없음 —
  -- 수락된 자리를 비우는 건 남은 사람들에게 비용이다.
  if my.status = 'waiting' then
    perform session_fee_refund(p_session, me_id);
  end if;

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  6. 호스트 탈퇴 — 모임이 사라지면 전원 반환
-- ───────────────────────────────────────────────────────────────
-- 20260815203000 의 account_delete 를 대체한다 (반환 블록 추가).
create or replace function account_delete()
returns json language plpgsql security definer set search_path = public as $$
declare
  me_id    uuid := auth.uid();
  my_email text;
  g        record;
  nxt      signups;
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;

  -- 내가 연 다가올 모임은 통째로 사라진다 — 신청자들 돈부터 돌려준다
  for g in
    select sg.session_id, sg.user_id
      from signups sg join sessions ss on ss.id = sg.session_id
     where ss.host_id = me_id and ss.starts_at > now()
       and ss.status in ('open','confirmed')
       and sg.status in ('waiting','confirmed')
       and sg.user_id <> me_id
  loop
    perform session_fee_refund(g.session_id, g.user_id);
  end loop;

  -- 참가자로 확정돼 있던 자리는 대기 1순위를 승격시킨다
  for g in
    select s.session_id, s.gender
      from signups s join sessions ss on ss.id = s.session_id
     where s.user_id = me_id and s.status = 'confirmed' and ss.starts_at > now()
  loop
    select * into nxt from signups
     where session_id = g.session_id and gender = g.gender and status = 'waiting'
     order by created_at limit 1;
    if found then
      update signups set status = 'confirmed'
       where session_id = nxt.session_id and user_id = nxt.user_id;
    end if;
  end loop;

  -- 내가 연 다가올 모임은 취소로 표시한다. host_id 는 set null 이라
  -- 행은 남고, 참가자에게는 "취소됨" 으로 보인다.
  update sessions set status = 'cancelled'
   where host_id = me_id and starts_at > now() and status in ('open','confirmed');

  select email into my_email from auth.users where id = me_id;
  if my_email is not null and my_email <> '' then
    insert into deleted_accounts (email_hash) values (account_email_hash(my_email))
    on conflict (email_hash) do update set deleted_at = now();
  end if;

  -- 보관 기간이 지난 흔적은 여기서 같이 정리한다 (별도 배치 불필요)
  delete from deleted_accounts
   where deleted_at < now() - (account_rejoin_block_days() || ' days')::interval;

  -- 나머지는 전부 cascade 로 딸려 나간다
  delete from auth.users where id = me_id;

  return json_build_object('ok', true);
end; $$;

-- ───────────────────────────────────────────────────────────────
--  7. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function session_fee_refund(uuid,uuid) from public, anon, authenticated;
revoke execute on function session_join(uuid)            from public, anon;
revoke execute on function session_reject(uuid,uuid)     from public, anon;
revoke execute on function session_cancel(uuid)          from public, anon;
revoke execute on function account_delete()              from public, anon;

grant execute on function
  session_join(uuid), session_reject(uuid,uuid), session_cancel(uuid),
  account_delete()
to authenticated;
