-- Dedicated EMPTY test database only. Never run this fixture on a live project.
\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end;$$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
create schema private;
create function private.classroom_join_allowed(text) returns boolean language sql as $$select true$$;
create table public.sessions(join_code text,status text);
create table public.quiz_live_sessions(join_code text,status text);
create table private.bluff_sessions(join_code text,phase text);
create table private.yesno_sessions(join_code text,phase text);
create table private.rather_sessions(join_code text,phase text);
create table private.same_sessions(join_code text,phase text);
\ir ../supabase/closer.sql

do $$declare u uuid:=gen_random_uuid();other uuid:=gen_random_uuid();sid uuid;a uuid;b uuid;c uuid;d uuid;e uuid;
 j jsonb;st jsonb;code text;ids bigint[];game uuid;q bigint;q2 bigint;
begin
 insert into auth.users values(u),(other);
 assert public.closer_question_list()->>'error'='NOT_AUTHENTICATED';
 perform set_config('request.jwt.claim.sub',u::text,false);
 -- Ten starter questions per teacher, each with a numeric answer and a unit.
 j:=public.closer_question_list();assert jsonb_array_length(j->'questions')=10,j::text;
 assert (select count(*) from jsonb_array_elements(j->'questions') v where v ? 'answer' and v ? 'unit')=10;
 assert (select (v->>'answer')::numeric=42.195 and v->>'unit'='km' from jsonb_array_elements(j->'questions') v where v->>'question'='Wie lang ist ein Marathon?');
 select array_agg((v->>'id')::bigint) into ids from jsonb_array_elements(j->'questions') v;
 assert public.closer_create(11,null)->>'error'='NOT_ENOUGH_QUESTIONS';
 assert public.closer_create(2,array[ids[1],ids[1]])->>'error'='INVALID_SELECTION';
 assert public.closer_create(0,null)->>'error'='INVALID_ROUND_COUNT';
 -- Input validation: text length, numbers only (dot as decimal separator), short units.
 assert public.closer_question_save(null,'tiny','5','')->>'error'='INVALID_QUESTION';
 assert public.closer_question_save(null,'Wie viele Stühle stehen im Raum?','viele','')->>'error'='INVALID_ANSWER';
 assert public.closer_question_save(null,'Wie viele Stühle stehen im Raum?','1,5','')->>'error'='INVALID_ANSWER';
 assert public.closer_question_save(null,'Wie viele Stühle stehen im Raum?',null,'')->>'error'='INVALID_ANSWER';
 assert public.closer_question_save(null,'Wie viele Stühle stehen im Raum?','2000000000000','')->>'error'='INVALID_ANSWER';
 assert public.closer_question_save(null,'Wie viele Stühle stehen im Raum?','30',repeat('x',21))->>'error'='INVALID_UNIT';
 j:=public.closer_question_save(null,'Wie viele Seiten hat das Testbuch?','100','Seiten');q:=(j->>'id')::bigint;assert j->>'ok'='true',j::text;
 j:=public.closer_question_save(null,'Wie warm ist es im Testlabor?','-2.5','°C');q2:=(j->>'id')::bigint;assert j->>'ok'='true',j::text;
 assert (select (v->>'answer')::numeric=-2.5 from jsonb_array_elements(public.closer_question_list()->'questions') v where (v->>'id')::bigint=q2);
 assert public.closer_question_save(q2,'Wie kalt ist es im Testlabor?','-3','°C')->>'ok'='true';
 assert public.closer_quiz_save(null,'Unsere Runde',array[q,q2])->>'ok'='true';
 game:=(public.closer_quiz_list()->'quizzes'->0->>'id')::uuid;
 -- Saved question copies survive deletion and can still be edited/started.
 assert public.closer_question_delete(q2)->>'ok'='true';
 assert public.closer_quiz_save(game,'Unsere Runde',array[q,q2])->>'ok'='true';
 j:=public.closer_quiz_start(game);sid:=(j->>'session_id')::uuid;code:=j->>'join_code';
 assert j->>'ok'='true',j::text;
 assert public.classroom_resolve_code(code,null)->'kinds'='["closer"]'::jsonb;
 assert public.classroom_resolve_code(code,'closer')->'kinds'='["closer"]'::jsonb;
 assert public.classroom_resolve_code(code,'rather')->>'error'='SESSION_NOT_FOUND';
 assert public.closer_host_action(sid,0,'lobby','start')->>'error'='NEED_TWO_PLAYERS';
 -- Other teachers can neither see nor steer this game or catalogue.
 perform set_config('request.jwt.claim.sub',other::text,false);
 assert public.closer_host_state(sid)->>'error'='NOT_OWNER';
 assert public.closer_host_action(sid,0,'lobby','end')->>'error'='NOT_OWNER';
 assert public.closer_question_save(ids[1],'Fremde Frage ändern?','1','')->>'error'='NOT_OWNER';
 assert public.closer_question_delete(ids[1])->>'error'='NOT_OWNER';
 assert public.closer_quiz_delete(game)->>'error'='NOT_OWNER';
 assert public.closer_quiz_start(game)->>'error'='NOT_OWNER';
 assert public.closer_create(1,array[ids[1]])->>'error'='INVALID_SELECTION';
 assert jsonb_array_length(public.closer_question_list()->'questions')=10;
 perform set_config('request.jwt.claim.sub','',false);
 j:=public.closer_join(code,'Ada',repeat('a',64));a:=(j->>'player_id')::uuid;assert j->>'ok'='true',j::text;
 assert public.closer_join(code,'ada ',repeat('f',64))->>'error'='NAME_TAKEN';
 assert public.closer_join(code,'Eve','short')->>'error'='INVALID_PARTICIPANT_TOKEN';
 b:=(public.closer_join(code,'Ben',repeat('b',64))->>'player_id')::uuid;
 c:=(public.closer_join(code,'Cleo',repeat('c',64))->>'player_id')::uuid;
 d:=(public.closer_join(code,'Dora',repeat('d',64))->>'player_id')::uuid;
 e:=(public.closer_join(code,'Emil',repeat('e',64))->>'player_id')::uuid;
 assert public.closer_player_state(sid,a,repeat('b',64))->>'error'='INVALID_PARTICIPANT_TOKEN';
 st:=public.closer_player_state(sid,a,repeat('a',64));assert st->'question'='null'::jsonb;assert st->'answer'='null'::jsonb;assert st->'results'='[]'::jsonb;
 assert public.closer_guess(sid,a,repeat('a',64),0,'100')->>'error'='PHASE_CHANGED';
 perform set_config('request.jwt.claim.sub',u::text,false);
 assert public.closer_host_action(sid,0,'lobby','start')->>'ok'='true';
 assert public.closer_join(code,'Late',repeat('9',64))->>'error'='GAME_ALREADY_STARTED';
 assert public.closer_join(code,'Ada',repeat('a',64))->>'player_id'=a::text;
 -- During guessing nobody sees the answer, not even the board on the projector.
 st:=public.closer_host_state(sid);
 assert st->>'question'='Wie viele Seiten hat das Testbuch?';assert st->>'unit'='Seiten';
 assert st->'answer'='null'::jsonb;assert st->'results'='[]'::jsonb;
 assert public.closer_host_action(sid,0,'guess','scores')->>'error'='INVALID_ACTION';
 assert public.closer_host_action(sid,0,'guess','reveal')->>'error'='NO_GUESSES';
 assert public.closer_guess(sid,a,repeat('a',64),0,'zehn')->>'error'='INVALID_GUESS';
 assert public.closer_guess(sid,a,repeat('a',64),0,'1,5')->>'error'='INVALID_GUESS';
 assert public.closer_guess(sid,a,repeat('a',64),1,'100')->>'error'='PHASE_CHANGED';
 -- A guess can be changed until the reveal; the last value counts.
 assert public.closer_guess(sid,a,repeat('a',64),0,'90')->>'ok'='true';
 assert public.closer_guess(sid,a,repeat('a',64),0,'100')->>'ok'='true';
 assert public.closer_guess(sid,b,repeat('b',64),0,'105')->>'ok'='true';
 assert public.closer_guess(sid,c,repeat('c',64),0,'95')->>'ok'='true';
 assert public.closer_guess(sid,d,repeat('d',64),0,'110.5')->>'ok'='true';
 st:=public.closer_player_state(sid,a,repeat('a',64));
 assert (st->>'own_guess')::numeric=100;assert st->'answer'='null'::jsonb;assert st->'results'='[]'::jsonb;
 assert (select (v->>'guessed')::boolean from jsonb_array_elements(st->'players') v where v->>'id'=d::text);
 assert not (select (v->>'guessed')::boolean from jsonb_array_elements(st->'players') v where v->>'id'=e::text);
 assert (select count(*)=4 from private.closer_guesses where session_id=sid);
 assert (select sum(score)=0 from private.closer_players where session_id=sid);
 assert public.closer_host_action(sid,0,'guess','reveal')->>'ok'='true';
 assert public.closer_host_action(sid,0,'guess','reveal')->>'error'='PHASE_CHANGED';
 assert public.closer_guess(sid,e,repeat('e',64),0,'100')->>'error'='PHASE_CHANGED';
 -- Exact hit 3 points; Ben and Cleo are equally close and share second place (2 each);
 -- Dora is fourth (0); Emil did not guess (0).
 assert (select score from private.closer_players where id=a)=3;
 assert (select score from private.closer_players where id=b)=2;
 assert (select score from private.closer_players where id=c)=2;
 assert (select score from private.closer_players where id=d)=0;
 assert (select score from private.closer_players where id=e)=0;
 st:=public.closer_player_state(sid,e,repeat('e',64));
 assert (st->>'answer')::numeric=100;
 assert jsonb_array_length(st->'results')=4;
 assert st->'results'->0->>'name'='Ada' and (st->'results'->0->>'distance')::numeric=0 and (st->'results'->0->>'points')::int=3;
 assert st->'results'->3->>'name'='Dora' and (st->'results'->3->>'distance')::numeric=10.5;
 assert public.closer_host_action(sid,0,'reveal','scores')->>'ok'='true';
 assert public.closer_host_action(sid,0,'leaderboard','next')->>'ok'='true';
 st:=public.closer_host_state(sid);
 assert st->>'phase'='guess' and (st->>'round_index')::int=1;
 assert st->>'question'='Wie kalt ist es im Testlabor?' and st->'answer'='null'::jsonb;
 -- Negative answers and decimals: only Ben guesses, he is closest and gets 3 points.
 assert public.closer_guess(sid,b,repeat('b',64),1,'-1')->>'ok'='true';
 assert public.closer_host_action(sid,1,'guess','reveal')->>'ok'='true';
 assert (select score from private.closer_players where id=b)=5;
 assert (public.closer_host_state(sid)->>'answer')::numeric=-3;
 assert public.closer_host_action(sid,1,'reveal','next')->>'ok'='true';
 st:=public.closer_host_state(sid);assert st->>'phase'='ended';assert st->'question'='null'::jsonb;
 assert st->'players'->0->>'name'='Ben',st::text;
 assert public.classroom_resolve_code(code,null)->>'error'='SESSION_NOT_FOUND';
 -- Ending is idempotent; a fresh random game can be created and ended immediately.
 assert public.closer_host_action(sid,1,'ended','end')->>'ok'='true';
 j:=public.closer_create(3,null);assert j->>'ok'='true';
 assert public.closer_host_action((j->>'session_id')::uuid,0,'lobby','end')->>'ok'='true';
 assert public.closer_quiz_delete(game)->>'ok'='true';
 -- Clients only reach the data through the checked functions.
 assert not has_table_privilege('anon','private.closer_guesses','select');
 assert not has_table_privilege('authenticated','private.closer_questions','select');
 assert not has_function_privilege('anon','public.closer_host_action(uuid,integer,text,text)','execute');
 assert has_function_privilege('anon','public.closer_guess(uuid,uuid,text,integer,text)','execute');
 raise notice 'PASS: closer catalogue, ownership, hidden answers, guesses, scoring with ties, rounds and ending';
end;$$;
