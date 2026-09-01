create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  scene_json jsonb not null check (jsonb_typeof(scene_json) = 'array'),
  thumbnail_path text,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated_idx on public.projects(user_id, updated_at desc);
alter table public.projects enable row level security;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  text_requests integer not null default 0 check (text_requests >= 0),
  image_requests integer not null default 0 check (image_requests >= 0),
  voice_requests integer not null default 0 check (voice_requests >= 0),
  estimated_tokens integer not null default 0 check (estimated_tokens >= 0),
  primary key (user_id, usage_date)
);
alter table public.ai_usage enable row level security;
create policy "usage_select_own" on public.ai_usage for select using (auth.uid() = user_id);
-- No client INSERT/UPDATE/DELETE policies: only server service role may mutate usage.

create or replace function public.consume_ai_usage(p_user_id uuid, p_kind text, p_user_limit integer, p_global_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_user_count integer; global_count bigint;
begin
  if p_kind not in ('text','image','voice') then raise exception 'invalid usage kind'; end if;
  insert into public.ai_usage(user_id, usage_date) values (p_user_id, current_date) on conflict do nothing;
  select case p_kind when 'text' then text_requests when 'image' then image_requests else voice_requests end
    into current_user_count from public.ai_usage where user_id=p_user_id and usage_date=current_date for update;
  select coalesce(sum(text_requests + image_requests + voice_requests),0) into global_count from public.ai_usage where usage_date=current_date;
  if current_user_count >= p_user_limit or global_count >= p_global_limit then return false; end if;
  update public.ai_usage set
    text_requests=text_requests + case when p_kind='text' then 1 else 0 end,
    image_requests=image_requests + case when p_kind='image' then 1 else 0 end,
    voice_requests=voice_requests + case when p_kind='voice' then 1 else 0 end
  where user_id=p_user_id and usage_date=current_date;
  return true;
end $$;
revoke all on function public.consume_ai_usage(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_ai_usage(uuid,text,integer,integer) to service_role;
