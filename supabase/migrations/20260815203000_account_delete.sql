-- ═══════════════════════════════════════════════════════════════
--  회원 탈퇴
--
--  탈퇴는 auth.users 한 줄을 지우는 것으로 끝난다 — 프로필부터
--  신청·매칭·메시지·크레딧까지 전부 on delete cascade 로 딸려 나간다.
--  다만 두 가지가 cascade 로 해결되지 않는다.
--
--   1) 내가 연 모임 — sessions.host_id 가 cascade 라서 개설자가 탈퇴하면
--      남의 모임이 통째로 사라진다. 확정돼서 날짜만 기다리던 사람들이
--      아무 안내 없이 모임을 잃는다. → set null 로 바꾸고 "취소" 로 표시한다.
--   2) 스토리지 파일 — 사진·영상은 DB 밖(storage)에 있어 cascade 가 닿지 않는다.
--      앱에서 계정을 지우기 "전에" 먼저 지운다 (web/src/lib/supabase.ts 의
--      deleteAccount). 지운 뒤에는 권한이 없어져 손댈 수 없다.
--
--  몇 번 돌려도 안전하다.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  0. 사전 점검 — auth.users 를 지울 권한이 있는지
-- ───────────────────────────────────────────────────────────────
-- security definer 함수는 소유자 권한으로 돈다. 호스팅 Supabase 에서
-- 마이그레이션 소유자(postgres)는 보통 권한이 있지만, 없으면 탈퇴가
-- 런타임에 조용히 실패한다. 여기서 미리 알아채자.
do $$
begin
  if not has_table_privilege(current_user, 'auth.users', 'DELETE') then
    raise warning '[탈퇴] % 에게 auth.users DELETE 권한이 없다. account_delete() 가 실패한다.', current_user;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────
--  1. 개설자가 빠져도 모임 행은 남긴다
-- ───────────────────────────────────────────────────────────────
alter table sessions alter column host_id drop not null;

alter table sessions drop constraint if exists sessions_host_id_fkey;
alter table sessions add constraint sessions_host_id_fkey
  foreign key (host_id) references profiles(id) on delete set null;

-- ───────────────────────────────────────────────────────────────
--  2. 재가입 흔적 (가입 보너스 반복 수령 차단)
-- ───────────────────────────────────────────────────────────────
-- 탈퇴 → 재가입을 반복하면 profile_complete 보너스를 무한히 받을 수 있다.
-- 이메일 원문은 남기지 않는다. 해시만 두고 보관 기간이 지나면 스스로 지운다.
-- (탈퇴는 언제든 다시 할 수 있게 두고, "보너스만" 막는다)
create table if not exists deleted_accounts (
  email_hash text primary key,
  deleted_at timestamptz not null default now()
);

alter table deleted_accounts enable row level security;
-- 정책 없음 = 클라이언트 직접 접근 차단. 아래 함수로만 읽고 쓴다.

create or replace function account_rejoin_block_days() returns int
  language sql immutable as $$ select 30 $$;

-- 솔트를 붙여 이메일 목록 대조(rainbow table)를 막는다.
-- pgcrypto 의 digest() 는 extensions 스키마에 있어 search_path 를 타므로
-- 코어 내장 sha256(bytea) 을 쓴다.
create or replace function account_email_hash(p_email text) returns text
  language sql immutable as $$
  select encode(sha256(convert_to(lower(trim(p_email)) || '::hobiday-acct-v1', 'utf8')), 'hex')
$$;

-- ───────────────────────────────────────────────────────────────
--  3. 탈퇴
-- ───────────────────────────────────────────────────────────────
create or replace function account_delete()
returns json language plpgsql security definer set search_path = public as $$
declare
  me_id    uuid := auth.uid();
  my_email text;
  g        record;
  nxt      signups;
begin
  if me_id is null then return json_build_object('error','no_auth'); end if;

  -- 다가올 모임의 확정 자리는 정상 취소 절차를 밟는다.
  -- 그냥 지우면 남은 사람들은 성비가 깨진 줄도 모른 채 방치된다.
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
--  4. 가입 보너스 — 재가입이면 건너뛴다
-- ───────────────────────────────────────────────────────────────
-- 20260813184013_credits.sql 의 정의를 대체한다.
-- 저쪽을 고칠 때 이 블록도 같이 봐야 한다.
create or replace function claim_profile_bonus()
returns json language plpgsql security definer set search_path = public as $$
declare me profiles; my_email text; earned int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return json_build_object('error','no_profile'); end if;
  if me.photo is null or me.career is null then
    return json_build_object('error','incomplete');
  end if;

  select email into my_email from auth.users where id = me.id;
  if my_email is not null and exists (
    select 1 from deleted_accounts
     where email_hash = account_email_hash(my_email)
       and deleted_at > now() - (account_rejoin_block_days() || ' days')::interval
  ) then
    -- 재가입. 앱은 조용히 넘어간다 ("혜택 못 받는다" 를 알릴 이유가 없다)
    return json_build_object('ok', true, 'earned', 0,
                             'balance', credit_balance(me.id), 'rejoin', true);
  end if;

  earned := credit_grant(me.id, 'profile_complete');

  return json_build_object('ok', true, 'earned', earned,
                           'balance', credit_balance(me.id));
end; $$;

-- ───────────────────────────────────────────────────────────────
--  5. 권한
-- ───────────────────────────────────────────────────────────────
revoke execute on function account_delete()             from public, anon;
revoke execute on function account_email_hash(text)     from public, anon, authenticated;
revoke execute on function account_rejoin_block_days()  from public, anon, authenticated;
revoke execute on function claim_profile_bonus()        from public, anon;

grant execute on function account_delete(), claim_profile_bonus() to authenticated;
