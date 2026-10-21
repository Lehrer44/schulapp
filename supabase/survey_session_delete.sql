-- Allow teachers to delete an individual owned survey session.
-- Existing foreign keys cascade to participants and responses; templates remain.
begin;
drop policy if exists sessions_teacher_delete on public.sessions;
create policy sessions_teacher_delete on public.sessions
for delete to authenticated
using ((select auth.uid()) = owner_id);
grant delete on public.sessions to authenticated;
commit;
