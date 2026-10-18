-- Dedicated test database after bluff-db.sql only; never install fixtures on a live project.
\set ON_ERROR_STOP on
\ir ../supabase/external_links.sql
begin;
insert into auth.users(id) values('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
insert into public.teacher_external_links(id,name,url) values('44444444-4444-4444-8444-444444444444','Mein Link','https://example.org/a');
do $$begin
 assert (select count(*)=1 from public.teacher_external_links);
 begin insert into public.teacher_external_links(owner_id,name,url) values('33333333-3333-4333-8333-333333333333','Fremd','https://example.org');raise exception 'Foreign owner accepted';exception when insufficient_privilege then null;end;
 begin insert into public.teacher_external_links(name,url) values('Script','javascript:alert(1)');raise exception 'Unsafe URL accepted';exception when check_violation then null;end;
 begin insert into public.teacher_external_links(name,url) values('   ','https://example.org');raise exception 'Empty name accepted';exception when check_violation then null;end;
 begin update public.teacher_external_links set owner_id='33333333-3333-4333-8333-333333333333';raise exception 'Owner reassignment accepted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
set local role authenticated;
do $$begin assert (select count(*)=0 from public.teacher_external_links);end;$$;
delete from public.teacher_external_links where id='44444444-4444-4444-8444-444444444444';
insert into public.teacher_external_links(name,url) values('Zweites Konto','http://example.net');
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $$begin assert (select count(*)=1 from public.teacher_external_links);end;$$;
delete from public.teacher_external_links where id='44444444-4444-4444-8444-444444444444';
do $$begin assert (select count(*)=0 from public.teacher_external_links);end;$$;
reset role;
set local role anon;
do $$begin
 begin perform name from public.teacher_external_links;raise exception 'Anonymous read accepted';exception when insufficient_privilege then null;end;
 begin insert into public.teacher_external_links(name,url) values('Anon','https://example.org');raise exception 'Anonymous write accepted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
rollback;
select 'PASS: external link ownership, isolation, insert/delete, URL validation and anonymous denial' as result;
