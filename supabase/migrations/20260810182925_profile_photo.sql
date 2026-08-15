-- ═══════════════════════════════════════════════════════════════
--  프로필 대표 사진
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run · 몇 번 돌려도 안전
-- ═══════════════════════════════════════════════════════════════
--
-- 공개 범위
--   사람 찾기에 프로필을 올린(is_public) 사람의 사진만, 로그인한 유저에게 보인다.
--   버킷은 비공개이고 재생/표시는 서명 URL 로만 한다 —
--   public 버킷으로 두면 URL 만으로 얼굴 사진이 인터넷에 노출된다.

alter table profiles
  add column if not exists photo text;   -- 스토리지 경로 ({user_id}/avatar.jpg)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'];

-- 쓰기: 내 폴더만
drop policy if exists "profile photos: own write" on storage.objects;
create policy "profile photos: own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile photos: own update" on storage.objects;
create policy "profile photos: own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile photos: own delete" on storage.objects;
create policy "profile photos: own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 읽기: 내 사진 + 공개 프로필인 사람의 사진
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
    )
  );

-- 받은 관심 카드에도 사진이 보여야 수락 판단이 된다
create or replace function requests_received()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) from (
    select r.id, r.message, r.status, r.created_at,
           p.id as from_id, p.nickname, p.age, p.level, p.career,
           p.height, p.home_gym, p.area, p.mbti, p.intro, p.photo
      from requests r join profiles p on p.id = r.from_id
     where r.to_id = auth.uid() and r.status = 'pending'
  ) t;
$$;

revoke execute on function requests_received() from public, anon;
grant execute on function requests_received() to authenticated;
