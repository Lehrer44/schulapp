-- Personal dashboard links. Access is restricted by RLS to the signed-in owner.
create table if not exists public.teacher_external_links(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 120),
 url text not null check(length(url) between 1 and 2048 and url ~ '^https?://[^[:space:]]+$'),
 created_at timestamptz not null default now()
);
create index if not exists teacher_external_links_owner_idx on public.teacher_external_links(owner_id,created_at,id);
alter table public.teacher_external_links enable row level security;
drop policy if exists teacher_external_links_select_own on public.teacher_external_links;
create policy teacher_external_links_select_own on public.teacher_external_links for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists teacher_external_links_insert_own on public.teacher_external_links;
create policy teacher_external_links_insert_own on public.teacher_external_links for insert to authenticated with check(owner_id=(select auth.uid()));
drop policy if exists teacher_external_links_delete_own on public.teacher_external_links;
create policy teacher_external_links_delete_own on public.teacher_external_links for delete to authenticated using(owner_id=(select auth.uid()));
revoke all on public.teacher_external_links from public,anon,authenticated;
grant select,insert,delete on public.teacher_external_links to authenticated;
