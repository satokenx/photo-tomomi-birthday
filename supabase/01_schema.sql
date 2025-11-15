-- Create extension for UUID generation (safe if already exists)
create extension if not exists "pgcrypto";

-- Photos table
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  uploader_id uuid not null,
  uploader_name text not null,
  uploaded_at timestamptz not null default now()
);

alter table public.photos enable row level security;

-- Anyone can read photos (album is viewable publicly)
drop policy if exists "Public read photos" on public.photos;
create policy "Public read photos"
on public.photos
for select
to public
using (true);

-- Only authenticated users can insert, and only for themselves
drop policy if exists "Authenticated insert photos" on public.photos;
create policy "Authenticated insert photos"
on public.photos
for insert
to authenticated
with check (auth.uid() = uploader_id);

-- Helpful index for ordering by date
create index if not exists photos_uploaded_at_idx on public.photos (uploaded_at desc);

-- Allow uploader to delete own photo rows
drop policy if exists "Authenticated delete own photos" on public.photos;
create policy "Authenticated delete own photos"
on public.photos
for delete
to authenticated
using (auth.uid() = uploader_id);

-- Create storage bucket (public so images can be viewed without auth)
insert into storage.buckets (id, name, public)
values ('tomomi-photos', 'tomomi-photos', true)
on conflict (id) do nothing;

-- Storage RLS policies
-- Public can read/list objects in this bucket
drop policy if exists "Public read tomomi-photos objects" on storage.objects;
create policy "Public read tomomi-photos objects"
on storage.objects
for select
to public
using (bucket_id = 'tomomi-photos');

-- Authenticated users can upload to this bucket
drop policy if exists "Authenticated upload tomomi-photos" on storage.objects;
create policy "Authenticated upload tomomi-photos"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'tomomi-photos');

-- Authenticated users can delete objects under their own uid prefix
drop policy if exists "Authenticated delete own tomomi-photos" on storage.objects;
create policy "Authenticated delete own tomomi-photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'tomomi-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);


