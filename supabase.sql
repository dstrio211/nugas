create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  course text not null check (char_length(trim(course)) between 1 and 120),
  assigned_date date not null,
  deadline_at timestamptz not null,
  task_type text not null check (task_type in ('Individual','Kelompok')),
  members text not null default '',
  status text not null default 'Belum mulai' check (status in ('Belum mulai','Dikerjakan','Siap dikumpulkan','Sudah dikumpulkan')),
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_deadline_idx on public.tasks (user_id, deadline_at asc);
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
create policy "Users can view their own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users can update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Users can view their own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);
