-- ══════════════════════════════════════════════════════════
--  HOBIDAY MVP v1 — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run
-- ══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────── 테이블 ───────────

create table if not exists app_config (
  key   text primary key,
  value text not null
);

create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  event_date     date,
  gym            text,
  open_rounds    int     not null default 0,      -- 0=비공개, 1~3 → 라운드2~4 순차 공개
  selection_open boolean not null default false,
  results_open   boolean not null default false,
  created_at     timestamptz default now()
);

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  token       text not null unique,
  name        text not null,
  gender      text not null check (gender in ('m','f')),
  slot        int  not null check (slot between 0 and 2),
  age         text,
  level       text,                                -- 초급 / 중급 / 상급
  home_gym    text,
  contact     text,                                -- 상호 매칭 시에만 공개
  survey      jsonb   not null default '{}'::jsonb,
  survey_done boolean not null default false,
  attended    boolean not null default true,
  created_at  timestamptz default now(),
  unique (event_id, gender, slot)
);

create table if not exists selections (
  chooser_id uuid not null references participants(id) on delete cascade,
  chosen_id  uuid not null references participants(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (chooser_id, chosen_id)
);

-- RLS 켜고 정책은 두지 않는다 → anon 키로 테이블 직접 접근 불가.
-- 접근은 아래 SECURITY DEFINER 함수로만 가능.
alter table app_config   enable row level security;
alter table events       enable row level security;
alter table participants enable row level security;
alter table selections   enable row level security;


-- ─────────── 내부 헬퍼 ───────────

-- 라운드 r(1~3)에서 (gender, slot)의 상대 슬롯
-- 남 i  ↔  여 (i + r - 1) % 3   → 3라운드로 9쌍 전부 커버
create or replace function _partner_slot(p_gender text, p_slot int, p_round int)
returns int language sql immutable as $$
  select case when p_gender = 'm'
              then (p_slot + p_round - 1) % 3
              else (p_slot - p_round + 1 + 3) % 3
         end;
$$;

create or replace function _pt(p_token text)
returns participants language sql stable security definer set search_path = public as $$
  select * from participants where token = p_token;
$$;


-- ─────────── 참가자용 RPC ───────────

-- 내 정보 + 이벤트 상태
create or replace function me(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare p participants; e events;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;
  select * into e from events where id = p.event_id;

  return json_build_object(
    'me', json_build_object('id',p.id,'name',p.name,'gender',p.gender,'level',p.level,
                            'survey',p.survey,'survey_done',p.survey_done),
    'event', json_build_object('title',e.title,'date',e.event_date,'gym',e.gym,
                               'open_rounds',e.open_rounds,
                               'selection_open',e.selection_open,
                               'results_open',e.results_open)
  );
end; $$;

-- 설문 저장
create or replace function save_survey(p_token text, p_survey jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare p participants;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;

  update participants
     set survey = p_survey,
         survey_done = true
   where id = p.id;

  return json_build_object('ok', true);
end; $$;

-- 공개된 라운드의 상대 정보 (연락처는 제외)
create or replace function my_rounds(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare p participants; e events; r int; ps int; partner participants; out_arr json[] := '{}';
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;
  select * into e from events where id = p.event_id;

  for r in 1..greatest(e.open_rounds,0) loop
    ps := _partner_slot(p.gender, p.slot, r);
    select * into partner
      from participants
     where event_id = p.event_id
       and gender = case when p.gender='m' then 'f' else 'm' end
       and slot = ps;

    if found then
      out_arr := out_arr || json_build_object(
        'round', r + 1,                       -- 표시용: 라운드 2·3·4
        'partner', json_build_object(
          'id', partner.id, 'name', partner.name,
          'level', partner.level, 'survey', partner.survey
        ));
    end if;
  end loop;

  return json_build_object('rounds', array_to_json(out_arr));
end; $$;

-- 비공개 최종 선택 제출 (기존 선택 덮어쓰기)
create or replace function submit_selection(p_token text, p_chosen uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare p participants; e events; cid uuid;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;
  select * into e from events where id = p.event_id;
  if not e.selection_open then return json_build_object('error','closed'); end if;

  delete from selections where chooser_id = p.id;

  foreach cid in array coalesce(p_chosen, '{}'::uuid[]) loop
    -- 같은 이벤트의 이성만 허용
    if exists (select 1 from participants x
                where x.id = cid and x.event_id = p.event_id and x.gender <> p.gender) then
      insert into selections(chooser_id, chosen_id) values (p.id, cid)
      on conflict do nothing;
    end if;
  end loop;

  return json_build_object('ok', true);
end; $$;

-- 내가 뭘 골랐는지 (다시 열었을 때 복원용)
create or replace function my_selection(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare p participants;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;
  return json_build_object('chosen',
    coalesce((select json_agg(chosen_id) from selections where chooser_id = p.id), '[]'::json));
end; $$;

-- 결과: 상호 선택된 상대만 연락처와 함께 반환
-- ⚠️ 짝사랑(내가 골랐지만 상대는 아닌 경우)은 절대 노출하지 않는다
create or replace function my_result(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare p participants; e events;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error','not_found'); end if;
  select * into e from events where id = p.event_id;
  if not e.results_open then return json_build_object('ready', false); end if;

  return json_build_object('ready', true, 'matches', coalesce((
    select json_agg(json_build_object('name', o.name, 'contact', o.contact))
      from selections s
      join participants o on o.id = s.chosen_id
     where s.chooser_id = p.id
       and exists (select 1 from selections b
                    where b.chooser_id = s.chosen_id and b.chosen_id = p.id)
  ), '[]'::json));
end; $$;


-- ─────────── 운영자용 RPC (admin_key 검증) ───────────

create or replace function _check_key(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_config where key='admin_key' and value = p_key);
$$;

create or replace function admin_events(p_key text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  return json_build_object('events', coalesce((
    select json_agg(json_build_object(
      'id',e.id,'title',e.title,'date',e.event_date,'gym',e.gym,
      'open_rounds',e.open_rounds,'selection_open',e.selection_open,'results_open',e.results_open,
      'n', (select count(*) from participants p where p.event_id=e.id),
      'done', (select count(*) from participants p where p.event_id=e.id and p.survey_done)
    ) order by e.created_at desc) from events e), '[]'::json));
end; $$;

create or replace function admin_create_event(p_key text, p_title text, p_date date, p_gym text)
returns json language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  insert into events(title, event_date, gym) values (p_title, p_date, p_gym) returning id into nid;
  return json_build_object('id', nid);
end; $$;

create or replace function admin_add_participant(
  p_key text, p_event uuid, p_name text, p_gender text, p_slot int,
  p_age text, p_level text, p_home_gym text, p_contact text)
returns json language plpgsql security definer set search_path = public as $$
declare tok text; nid uuid;
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  tok := encode(gen_random_bytes(12), 'hex');
  insert into participants(event_id, token, name, gender, slot, age, level, home_gym, contact)
  values (p_event, tok, p_name, p_gender, p_slot, p_age, p_level, p_home_gym, p_contact)
  on conflict (event_id, gender, slot) do update
    set name=excluded.name, age=excluded.age, level=excluded.level,
        home_gym=excluded.home_gym, contact=excluded.contact
  returning id, token into nid, tok;
  return json_build_object('id', nid, 'token', tok);
end; $$;

create or replace function admin_participants(p_key text, p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  return json_build_object('participants', coalesce((
    select json_agg(json_build_object(
      'id',id,'token',token,'name',name,'gender',gender,'slot',slot,'age',age,
      'level',level,'home_gym',home_gym,'contact',contact,
      'survey',survey,'survey_done',survey_done) order by gender, slot)
    from participants where event_id = p_event), '[]'::json));
end; $$;

create or replace function admin_set_stage(
  p_key text, p_event uuid, p_open_rounds int, p_selection boolean, p_results boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  update events set open_rounds = greatest(0, least(3, p_open_rounds)),
                    selection_open = p_selection,
                    results_open = p_results
   where id = p_event;
  return json_build_object('ok', true);
end; $$;

-- 운영자용 매칭 결과 집계
create or replace function admin_results(p_key text, p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  return json_build_object(
    'submitted', coalesce((select json_agg(distinct p.name)
                             from selections s join participants p on p.id=s.chooser_id
                            where p.event_id = p_event), '[]'::json),
    'matches', coalesce((
      select json_agg(json_build_object('a',a.name,'b',b.name,'a_contact',a.contact,'b_contact',b.contact))
        from selections s
        join participants a on a.id = s.chooser_id
        join participants b on b.id = s.chosen_id
       where a.event_id = p_event
         and a.gender = 'm'                                  -- 쌍 중복 제거
         and exists (select 1 from selections r
                      where r.chooser_id = s.chosen_id and r.chosen_id = s.chooser_id)
    ), '[]'::json));
end; $$;

create or replace function admin_delete_event(p_key text, p_event uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not _check_key(p_key) then return json_build_object('error','unauthorized'); end if;
  delete from events where id = p_event;
  return json_build_object('ok', true);
end; $$;


-- ─────────── 권한 ───────────
revoke all on all tables in schema public from anon, authenticated;

grant execute on function
  me(text), save_survey(text,jsonb), my_rounds(text),
  submit_selection(text,uuid[]), my_selection(text), my_result(text),
  admin_events(text), admin_create_event(text,text,date,text),
  admin_add_participant(text,uuid,text,text,int,text,text,text,text),
  admin_participants(text,uuid), admin_set_stage(text,uuid,int,boolean,boolean),
  admin_results(text,uuid), admin_delete_event(text,uuid)
to anon;


-- ─────────── 운영자 비밀키 설정 ───────────
-- ⚠️ 아래 'CHANGE_ME_뭔가_긴_문자열' 을 반드시 바꿀 것!
insert into app_config(key, value) values ('admin_key', 'CHANGE_ME_긴_랜덤_문자열')
on conflict (key) do nothing;
