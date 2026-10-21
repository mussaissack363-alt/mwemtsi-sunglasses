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
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

alter table public.site_media enable row level security;
alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.profiles enable row level security;

-- ------------------------------------------------------------
-- 4. Policies — public may READ, only admins may WRITE
-- ------------------------------------------------------------
-- products
drop policy if exists "Allow public read access to products" on public.products;
drop policy if exists "Allow all operations for products" on public.products;
drop policy if exists "Public read products" on public.products;
drop policy if exists "Admins write products" on public.products;

create policy "Public read products" on public.products
  for select using (true);
create policy "Admins write products" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- categories
drop policy if exists "Allow public read access to categories" on public.categories;
drop policy if exists "Allow all operations for categories" on public.categories;
drop policy if exists "Public read categories" on public.categories;
drop policy if exists "Admins write categories" on public.categories;

create policy "Public read categories" on public.categories
  for select using (true);
create policy "Admins write categories" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- site_media
drop policy if exists "Public read media" on public.site_media;
drop policy if exists "Admins write media" on public.site_media;

create policy "Public read media" on public.site_media
  for select using (true);
create policy "Admins write media" on public.site_media
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- profiles: you can read your own; only admins can change roles
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
-- 5. Storage bucket for uploaded images / videos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read media objects" on storage.objects;
drop policy if exists "Admins write media objects" on storage.objects;

create policy "Public read media objects" on storage.objects
  for select using (bucket_id = 'media');
create policy "Admins write media objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

-- ------------------------------------------------------------
-- 6. Make yourself an admin (run once, after you create a user)
-- ------------------------------------------------------------
-- 1) Supabase → Authentication → Users → "Add user" (email + password).
-- 2) Then run the line below with that email:
--
--    update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- 3) Sign in at /admin.html with that email + password.
