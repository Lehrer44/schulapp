-- Run on an installed survey schema. All synthetic data is rolled back.
begin;
do $fixture$
declare
 owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
 survey_id uuid:=gen_random_uuid(); other_survey_id uuid:=gen_random_uuid();
 active_id uuid:=gen_random_uuid(); ended_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid();
 participant_id uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(owner_id,'survey-access-'||owner_id||'@example.invalid'),(other_id,'survey-access-'||other_id||'@example.invalid');
 insert into public.surveys(id,owner_id,name,slides) values(survey_id,owner_id,'Access test','[]'),(other_survey_id,other_id,'Foreign test','[]');
 insert into public.sessions(id,survey_id,owner_id,title,status,join_code)
 values(active_id,survey_id,owner_id,'Access test','running',upper(substr(replace(active_id::text,'-',''),1,12))),
       (ended_id,survey_id,owner_id,'Access test','ended',upper(substr(replace(ended_id::text,'-',''),1,12))),
       (foreign_id,other_survey_id,other_id,'Foreign test','running',upper(substr(replace(foreign_id::text,'-',''),1,12)));
 insert into public.participants(id,session_id,name) values(participant_id,active_id,'Synthetic participant');
 insert into public.responses(session_id,participant_id,slide_index,answer) values(active_id,participant_id,0,'{"value":"Test"}');
 perform set_config('test.survey_access',jsonb_build_object('owner',owner_id,'survey',survey_id,'active',active_id,'ended',ended_id,'foreign',foreign_id,'participant',participant_id)::text,true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
end;
$fixture$;
set local role authenticated;
do $owner$
declare f jsonb:=current_setting('test.survey_access')::jsonb; n integer;
begin
 delete from public.sessions where id=(f->>'foreign')::uuid;get diagnostics n=row_count;assert n=0,'Foreign sessions must not be deleted';
 delete from public.sessions where id=(f->>'active')::uuid;get diagnostics n=row_count;assert n=1,'Owner can delete an active session';
 delete from public.sessions where id=(f->>'ended')::uuid;get diagnostics n=row_count;assert n=1,'Owner can delete an ended session';
end;
$owner$;
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $anonymous$
declare f jsonb:=current_setting('test.survey_access')::jsonb; n integer;
begin
 delete from public.sessions where id=(f->>'foreign')::uuid;get diagnostics n=row_count;assert n=0,'Anonymous access must not delete sessions';
end;
$anonymous$;
reset role;
do $verify$
declare f jsonb:=current_setting('test.survey_access')::jsonb;
begin
 assert exists(select 1 from public.sessions where id=(f->>'foreign')::uuid),'Foreign session remains';
 assert exists(select 1 from public.surveys where id=(f->>'survey')::uuid),'Survey template remains';
 assert not exists(select 1 from public.participants where id=(f->>'participant')::uuid),'Participants cascade';
 assert not exists(select 1 from public.responses where session_id=(f->>'active')::uuid),'Responses cascade';
end;
$verify$;
rollback;
select 'PASS: owned active/ended session deletion, foreign/anonymous isolation, cascades and template retention; fixtures rolled back' as result;
