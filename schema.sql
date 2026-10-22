-- ============================================================
--  Mwemtsi Sunglasses — database setup
--  Run this whole file in Supabase → SQL Editor → New query.
--  It is safe to run more than once (idempotent).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Catalogue
-- ------------------------------------------------------------
create table if not exists public.categories (
  id text primary key,
  name text not null
);

insert into public.categories (id, name) values
  ('men', 'Men'),
  ('women', 'Women')
on conflict (id) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category text references public.categories(id) on delete set null,
  name text not null,
  price_tzs numeric not null default 0,
  image_url text,
  position integer default 0,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_position_idx on public.products(position);

-- Keep the catalogue sane even if the admin panel is bypassed.
-- A row that violates these cannot be written by anybody, admin or not.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_name_len_chk'
  ) then
    alter table public.products
      add constraint products_name_len_chk
      check (char_length(btrim(name)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_price_nonneg_chk'
  ) then
    alter table public.products
      add constraint products_price_nonneg_chk
      check (price_tzs >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'products_image_url_chk'
  ) then
    alter table public.products
      add constraint products_image_url_chk
      check (
        image_url is null
        or btrim(image_url) = ''
        or (
          image_url !~ '[[:space:]]'
          and lower(image_url) not like 'javascript:%'
          and lower(image_url) not like 'data:%'
          and lower(image_url) not like 'vbscript:%'
          and char_length(image_url) <= 2048
        )
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Admin profiles  (role lives here, NOT in the browser)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz default now()
);

-- Every new auth user gets a profile automatically (defaults to viewer).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that already exist.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Single source of truth for "is this request an admin?".
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Media overrides (videos / photos an admin replaces)
-- ------------------------------------------------------------
create table if not exists public.site_media (
  key text primary key,
  url text not null,
  kind text not null default 'image' check (kind in ('image', 'video')),
  label text,
  -- Poster frame for videos. Generated from the uploaded file so the still
  -- image and the video always show the same shot.
  poster_url text,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_media_url_chk'
  ) then
    alter table public.site_media
      add constraint site_media_url_chk
      check (
        url !~ '[[:space:]]'
        and lower(url) not like 'javascript:%'
        and lower(url) not like 'data:%'
        and lower(url) not like 'vbscript:%'
        and char_length(url) <= 2048
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Keep updated_at honest
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists site_media_touch_updated_at on public.site_media;
create trigger site_media_touch_updated_at
  before update on public.site_media
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 5. Row level security on
-- ------------------------------------------------------------
alter table public.site_media enable row level security;
alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.profiles enable row level security;

-- ------------------------------------------------------------
-- 6. Policies — public may READ, only admins may WRITE
-- ------------------------------------------------------------
-- products
drop policy if exists "Allow all operations for products" on public.products;
drop policy if exists "Allow public read access to products" on public.products;
drop policy if exists "Public read products" on public.products;
drop policy if exists "Admins write products" on public.products;

create policy "Public read products" on public.products
  for select using (true);
create policy "Admins write products" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- categories
drop policy if exists "Allow all operations for categories" on public.categories;
drop policy if exists "Allow public read access to categories" on public.categories;
drop policy if exists "Public read categories" on public.categories;
drop policy if exists "Admins write categories" on public.categories;

create policy "Public read categories" on public.categories
  for select using (true);
create policy "Admins write categories" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- site_media
drop policy if exists "Allow all operations for site_media" on public.site_media;
drop policy if exists "Allow public read access to site_media" on public.site_media;
drop policy if exists "Public read media" on public.site_media;
drop policy if exists "Admins write media" on public.site_media;

create policy "Public read media" on public.site_media
  for select using (true);
create policy "Admins write media" on public.site_media
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- profiles: you can read your own; only admins can change roles
drop policy if exists "Allow all operations for profiles" on public.profiles;
drop policy if exists "Read own profile" on public.profiles;
drop policy if exists "Admins update profiles" on public.profiles;

create policy "Read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "Admins update profiles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.products, public.categories, public.site_media to anon, authenticated;

-- ------------------------------------------------------------
-- 7. Storage bucket for uploaded images / videos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true,
  26214400,  -- 25 MB hard ceiling, enforced by Storage itself
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read media objects" on storage.objects;
drop policy if exists "Admins write media objects" on storage.objects;
drop policy if exists "Allow all operations for storage objects" on storage.objects;

create policy "Public read media objects" on storage.objects
  for select using (bucket_id = 'media');
create policy "Admins write media objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

-- ------------------------------------------------------------
-- 8. Make yourself an admin (run once, after you create a user)
-- ------------------------------------------------------------
-- 1) Supabase → Authentication → Users → "Add user" (email + password).
-- 2) Then run the line below with that email:
--
--    update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- 3) Sign in at /admin.html with that email + password.
