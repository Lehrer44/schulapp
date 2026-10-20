-- Dedicated EMPTY database only; never run this fixture on a Supabase project.
\set ON_ERROR_STOP on
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
end;$$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
create schema private;
grant usage on schema private to anon,authenticated;
create function private.classroom_join_allowed(text) returns boolean language sql as $$select true$$;
create table public.sessions(join_code text,status text);
create table public.quiz_live_sessions(join_code text,status text);
create table private.bluff_sessions(join_code text,phase text);
\ir ../supabase/yesno.sql
\ir ../supabase/yesno_settings.sql

do $$
declare teacher uuid:=gen_random_uuid();other uuid:=gen_random_uuid();sid uuid;sid2 uuid;gid uuid;qid bigint;seed bigint;personal bigint;req uuid:=gen_random_uuid();a uuid;b uuid;c uuid;j jsonb;st jsonb;code text;rev bigint;
begin
 insert into auth.users values(teacher),(other);
 assert public.yesno_question_list()->>'error'='NOT_AUTHENTICATED';
 perform set_config('request.jwt.claim.sub',teacher::text,false);
 assert jsonb_array_length(public.yesno_question_list()->'questions')=15;
 select id into seed from private.yesno_questions where seed_key='alltag1';
 j:=public.yesno_question_save(seed,'Meine persönliche Startfrage?','Persönlich');personal:=(j->>'id')::bigint;
 assert personal<>seed;
 assert not exists(select 1 from private.yesno_available_questions() where id=seed);
 perform set_config('request.jwt.claim.sub',other::text,false);
 assert exists(select 1 from private.yesno_available_questions() where id=seed);
 assert not exists(select 1 from private.yesno_available_questions() where id=personal);
 assert public.yesno_question_delete(personal)->>'error'='NOT_OWNER';
 assert public.yesno_question_save(personal,'Fremder Eingriff?','Test')->>'error'='NOT_OWNER';
 perform set_config('request.jwt.claim.sub',teacher::text,false);
 j:=public.yesno_question_save(null,'Magst du Experimente?','Test');qid:=(j->>'id')::bigint;
 j:=public.yesno_game_save(null,'Unser Spiel',array[qid,personal]);gid:=(j->>'id')::uuid;
 assert j->>'ok'='true',j::text;
 assert public.yesno_game_save(null,'Falsch',array[qid,qid])->>'error'='INVALID_SELECTION';
 assert public.yesno_question_delete(qid)->>'ok'='true';
 assert public.yesno_game_save(gid,'Unser Spiel',array[qid,personal])->>'ok'='true','saved snapshots survive deletion';
 assert public.yesno_create(gen_random_uuid(),null,1,4,3,1,null)->>'error'='INVALID_SETTINGS';
 assert public.yesno_create(gen_random_uuid(),null,1,30,1,3,null)->>'error'='INVALID_SETTINGS';
 assert public.yesno_create(gen_random_uuid(),null,50,30,3,1,null)->>'error'='NOT_ENOUGH_QUESTIONS';
 assert public.yesno_create(gen_random_uuid(),null,1,30,3,1,array['Nicht vorhanden'])->>'error'='NOT_ENOUGH_QUESTIONS';
 j:=public.yesno_create(req,gid,2,30,5,2,null);sid:=(j->>'session_id')::uuid;code:=j->>'join_code';assert j->>'ok'='true',j::text;
 assert public.yesno_create(req,gid,2,30,5,2,null)->>'session_id'=sid::text,'retry creates no second lobby';
 assert public.classroom_resolve_code(code,'yesno')->'kinds'='["yesno"]'::jsonb;
 assert public.yesno_host_action(sid,0,'lobby','start')->>'error'='NEED_TWO_PLAYERS';
 j:=public.yesno_join(code,'Ada',repeat('a',64));a:=(j->>'player_id')::uuid;
 assert public.yesno_join(code,'Ada',repeat('a',64))->>'player_id'=a::text,'join retry idempotent';
 assert public.yesno_join(code,'ada',repeat('b',64))->>'error'='NAME_TAKEN';
 j:=public.yesno_join(code,'Ben',repeat('b',64));b:=(j->>'player_id')::uuid;
 j:=public.yesno_join(code,'Cleo',repeat('c',64));c:=(j->>'player_id')::uuid;
 assert public.yesno_host_action(sid,0,'lobby','start')->>'error'='NOT_ALL_READY';
 assert public.yesno_ready(sid,a,repeat('x',64),true)->>'error'='INVALID_PARTICIPANT_TOKEN';
 perform public.yesno_ready(sid,a,repeat('a',64),true);perform public.yesno_ready(sid,b,repeat('b',64),true);perform public.yesno_ready(sid,c,repeat('c',64),true);
 assert public.yesno_host_action(sid,0,'lobby','start')->>'ok'='true';
 assert public.yesno_join(code,'Late',repeat('d',64))->>'error'='GAME_ALREADY_STARTED';
 assert public.yesno_join(code,'Ada',repeat('a',64))->>'ok'='true','resume during running game';
 assert public.yesno_submit(sid,a,repeat('a',64),0,true,4)->>'error'='INVALID_ANSWER';
 assert public.yesno_submit(sid,a,repeat('a',64),0,null,1)->>'error'='INVALID_ANSWER';
 assert public.yesno_submit(sid,a,repeat('x',64),0,true,1)->>'error'='INVALID_PARTICIPANT_TOKEN';
 assert public.yesno_submit(sid,a,repeat('a',64),0,true,1)->>'ok'='true';
 assert public.yesno_submit(sid,a,repeat('a',64),0,true,1)->>'ok'='true';
 assert public.yesno_submit(sid,a,repeat('a',64),0,false,2)->>'error'='ALREADY_SUBMITTED';
 st:=public.yesno_host_state(sid);
 assert st->'yes_count'='null'::jsonb and st->'no_count'='null'::jsonb and st->'results'='[]'::jsonb and st->'own_answer'='null'::jsonb,'host sees no early answers';
 assert not(st->'players'->0 ? 'answer') and not(st->'players'->0 ? 'estimate');
 st:=public.yesno_player_state(sid,b,repeat('b',64));assert st->'own_answer'='null'::jsonb and st->'results'='[]'::jsonb;
 st:=public.yesno_player_state(sid,a,repeat('a',64));assert st->'own_answer'->>'answer'='true';
 assert public.yesno_submit(sid,b,repeat('b',64),0,false,2)->>'ok'='true';
 assert public.yesno_submit(sid,c,repeat('c',64),0,false,3)->>'ok'='true';
 st:=public.yesno_host_state(sid);assert st->>'phase'='result';assert st->>'yes_count'='1' and st->>'no_count'='2';
 assert (select points=5 from private.yesno_answers where player_id=a and round_index=0);
 assert (select points=2 from private.yesno_answers where player_id=b and round_index=0);
 assert (select points=0 from private.yesno_answers where player_id=c and round_index=0);
 assert not(st->'results'->0 ? 'answer'),'individual votes stay private after reveal';
 rev:=(st->>'revision')::bigint;perform public.yesno_host_state(sid);assert public.yesno_host_state(sid)->>'revision'=rev::text,'settlement idempotent';
 assert public.yesno_host_action(sid,0,'question','next')->>'error'='PHASE_CHANGED';
 perform set_config('request.jwt.claim.sub',other::text,false);
 assert public.yesno_host_state(sid)->>'error'='NOT_OWNER';
 assert public.yesno_host_action(sid,0,'result','next')->>'error'='NOT_OWNER';
 assert public.yesno_game_delete(gid)->>'error'='NOT_OWNER';
 assert public.yesno_create(gen_random_uuid(),gid,1,30,3,1,null)->>'error'='NOT_OWNER';
 perform set_config('request.jwt.claim.sub',teacher::text,false);
 assert public.yesno_host_action(sid,0,'result','next')->>'ok'='true';
 assert public.yesno_host_action(sid,0,'result','next')->>'error'='PHASE_CHANGED';
 assert public.yesno_submit(sid,a,repeat('a',64),0,true,1)->>'error'='PHASE_CHANGED';
 assert public.yesno_submit(sid,a,repeat('a',64),1,false,0)->>'ok'='true';
 update private.yesno_sessions set deadline=clock_timestamp()-interval '1 second' where id=sid;
 assert public.yesno_submit(sid,b,repeat('b',64),1,true,1)->>'error'='TIME_EXPIRED';
 st:=public.yesno_player_state(sid,c,repeat('c',64));assert st->>'phase'='finished';
 assert st->>'yes_count'='0' and st->>'no_count'='1','nonresponses are neither yes nor no';
 assert (select points=5 from private.yesno_answers where player_id=a and round_index=1);
 assert st->'players'->0->>'score'='10';
 assert public.yesno_host_action(sid,1,'finished','next')->>'error'='INVALID_ACTION';
 assert public.yesno_player_state(gen_random_uuid(),a,repeat('a',64))->>'error'='INVALID_PARTICIPANT_TOKEN';
 j:=public.yesno_create(gen_random_uuid(),null,1,30,3,1,array['Freizeit']);sid2:=(j->>'session_id')::uuid;
 assert (select questions->0->>'pack'='Freizeit' from private.yesno_sessions where id=sid2);
 assert public.yesno_host_action(sid2,0,'lobby','end')->>'ok'='true';
 assert public.yesno_host_action(sid2,0,'ended','end')->>'ok'='true';
 assert public.yesno_host_action(sid2,0,'ended','start')->>'error'='INVALID_ACTION';
 assert not has_table_privilege('anon','private.yesno_answers','SELECT');
 assert not has_table_privilege('authenticated','private.yesno_answers','SELECT');
 assert not has_table_privilege('anon','public.yesno_live_signals','UPDATE');
 assert not has_function_privilege('anon','private.yesno_state(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.yesno_host_state(uuid)','EXECUTE');
 assert has_function_privilege('anon','public.yesno_submit(uuid,uuid,text,integer,boolean,integer)','EXECUTE');
 assert (select count(*)=6 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('yesno_questions','yesno_hidden_questions','yesno_games','yesno_sessions','yesno_players','yesno_answers') and c.relrowsecurity);
 -- Anonymous callers can reach only the credential-checked APIs.
 perform set_config('request.jwt.claim.sub','',false);
 assert public.yesno_game_list()->>'error'='NOT_AUTHENTICATED';
end;$$;

set role anon;
select public.yesno_player_state('00000000-0000-4000-8000-000000000000','00000000-0000-4000-8000-000000000000',repeat('a',64));
reset role;

\ir yesno-settings-fixture.sql
