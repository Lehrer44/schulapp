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
\ir ../supabase/same.sql
\ir ../supabase/same_layout.sql

do $$declare u uuid:=gen_random_uuid();other uuid:=gen_random_uuid();sid uuid;sid2 uuid;ids bigint[];
 players uuid[];names text[]:=array['Ada','Ben','Cleo','Dora','Emil','Finn'];i integer;j jsonb;st jsonb;code text;quiz uuid;q bigint;
begin
 insert into auth.users values(u),(other);
 assert public.same_question_list()->>'error'='NOT_AUTHENTICATED';
 perform set_config('request.jwt.claim.sub',u::text,false);
 j:=public.same_question_list();assert jsonb_array_length(j->'questions')=10;
 select array_agg((v->>'id')::bigint order by (v->>'id')::bigint) into ids from jsonb_array_elements(j->'questions') v;
 assert j->'questions'->6->>'kind'='team';
 assert public.same_create(11,null)->>'error'='NOT_ENOUGH_QUESTIONS';
 assert public.same_create(2,array[ids[1],ids[1]])->>'error'='INVALID_SELECTION';
 q:=(public.same_question_save(null,'Nenne eine Farbe.','association')->>'id')::bigint;
 perform public.same_quiz_save(null,'Klasse',array[q,ids[7]]);
 quiz:=(public.same_quiz_list()->'quizzes'->0->>'id')::uuid;
 perform public.same_question_delete(q);
 assert public.same_quiz_save(quiz,'Klasse',array[q,ids[7]])->>'ok'='true';
 j:=public.same_quiz_start(quiz);sid:=(j->>'session_id')::uuid;code:=j->>'join_code';
 assert public.classroom_resolve_code(code,'same')->'kinds'='["same"]'::jsonb;
 perform set_config('request.jwt.claim.sub',other::text,false);
 assert public.same_host_state(sid)->>'error'='NOT_OWNER';
 assert public.same_manage(sid,0,'lobby','configure',null,3,'30')->>'error'='NOT_OWNER';
 assert public.same_quiz_start(quiz)->>'error'='NOT_OWNER';
 assert public.same_question_save(ids[1],'Fremde Frage ändern.','team')->>'error'='NOT_OWNER';
 perform set_config('request.jwt.claim.sub','',false);
 for i in 1..6 loop
  j:=public.same_join(code,names[i],repeat(i::text,64));assert j->>'ok'='true',j::text;
  players[i]:=(j->>'player_id')::uuid;
 end loop;
 assert public.same_join(code,'ada',repeat('7',64))->>'error'='NAME_TAKEN';
 assert public.same_player_state(sid,players[1],repeat('2',64))->>'error'='INVALID_PARTICIPANT_TOKEN';
 assert public.same_host_action(sid,0,'lobby','start')->>'error'='NOT_AUTHENTICATED';
 perform set_config('request.jwt.claim.sub',u::text,false);
 assert public.same_host_action(sid,0,'lobby','start')->>'error'='TEAMS_NOT_BALANCED';
 for i in 1..6 loop
  assert public.same_manage(sid,0,'lobby','assign',players[i],case when i<=3 then 1 else 2 end,null)->>'ok'='true';
 end loop;
 assert public.same_manage(sid,0,'lobby','configure',null,2,'30')->>'ok'='true';
 assert public.same_host_action(sid,0,'lobby','start')->>'ok'='true';
 assert public.same_manage(sid,0,'answers','assign',players[1],2,null)->>'error'='INVALID_ACTION';
 assert public.same_join(code,'Late',repeat('7',64))->>'error'='GAME_ALREADY_STARTED';
 assert public.same_answer(sid,players[1],repeat('1',64),0,' ROT ')->>'ok'='true';
 assert public.same_answer(sid,players[1],repeat('1',64),0,'ROT')->>'ok'='true';
 assert public.same_answer(sid,players[1],repeat('1',64),0,'Blau')->>'error'='ANSWER_ALREADY_CAST';
 st:=public.same_player_state(sid,players[2],repeat('2',64));
 assert not exists(select 1 from jsonb_array_elements(st->'players') v where v?'answer');
 assert st->'own_answer'='null'::jsonb;
 assert not exists(select 1 from jsonb_array_elements(public.same_host_state(sid)->'players') v where v?'answer');
 assert public.same_manage(sid,0,'answers','reveal',players[1],null,null)->>'error'='INVALID_ACTION';
 perform public.same_answer(sid,players[2],repeat('2',64),0,'rot');
 perform public.same_answer(sid,players[3],repeat('3',64),0,'Rot');
 perform public.same_answer(sid,players[4],repeat('4',64),0,'Blau');
 perform public.same_answer(sid,players[5],repeat('5',64),0,' blau ');
 perform public.same_answer(sid,players[6],repeat('6',64),0,'Grün');
 st:=public.same_host_state(sid);assert st->>'phase'='reveal';
 assert not exists(select 1 from jsonb_array_elements(st->'players') v where v?'answer');
 assert public.same_host_action(sid,0,'reveal','scores')->>'error'='REVEAL_FIRST';
 for i in 1..6 loop perform public.same_manage(sid,0,'reveal','reveal',players[i],null,null);end loop;
 st:=public.same_player_state(sid,players[2],repeat('2',64));
 assert (select v->>'answer'='ROT' from jsonb_array_elements(st->'players') v where v->>'id'=players[1]::text);
 assert public.same_manage(sid,0,'reveal','correct',players[6],null,'"Grün!"')->>'error'='INVALID_ACTION';
 assert (select answer='Grün' from private.same_answers where session_id=sid and player_id=players[6]);
 assert public.same_host_action(sid,0,'reveal','scores')->>'ok'='true';
 assert (select points=3 from private.same_points where session_id=sid and round_index=0 and team=1);
 assert (select points=1 from private.same_points where session_id=sid and round_index=0 and team=2);
 assert public.same_host_action(sid,0,'reveal','scores')->>'error'='PHASE_CHANGED';
 perform public.same_manage(sid,0,'leaderboard','override',null,2,'3');
 perform public.same_manage(sid,0,'leaderboard','override',null,2,'3');
 assert (select points=3 from private.same_points where session_id=sid and round_index=0 and team=2);
 assert public.same_manage(sid,0,'leaderboard','override',null,2,'4')->>'error'='INVALID_POINTS';
 assert public.same_manage(sid,0,'leaderboard','override',null,2,'2')->>'error'='INVALID_POINTS';
 perform public.same_host_action(sid,0,'leaderboard','next');
 assert public.same_answer(sid,players[1],repeat('1',64),0,'Ada')->>'error'='PHASE_CHANGED';
 assert public.same_answer(sid,players[1],repeat('1',64),1,'Dora')->>'error'='TEAM_NAME_REQUIRED';
 assert public.same_answer(sid,players[1],repeat('1',64),1,' ada ')->>'ok'='true';
 assert public.same_answer(sid,players[2],repeat('2',64),1,'Ada')->>'ok'='true';
 -- Expiry is enforced by the database, even without an open host tab.
 update private.same_sessions set deadline=clock_timestamp()-interval '1 second' where id=sid;
 assert public.same_answer(sid,players[3],repeat('3',64),1,'Ada')->>'error'='PHASE_CHANGED';
 assert public.same_player_state(sid,players[3],repeat('3',64))->>'phase'='reveal';
 perform public.same_manage(sid,1,'reveal','reveal',players[1],null,null);
 perform public.same_manage(sid,1,'reveal','reveal',players[2],null,null);
 perform public.same_host_action(sid,1,'reveal','scores');
 assert (select points=1 from private.same_points where session_id=sid and round_index=1 and team=1);
 assert (select points=0 from private.same_points where session_id=sid and round_index=1 and team=2);
 perform public.same_host_action(sid,1,'leaderboard','next');
 assert public.same_host_state(sid)->>'phase'='ended';
 -- Three teams of two: all equal earns 3, distinct answers earn 0.
 j:=public.same_create(1,array[ids[1]]);sid2:=(j->>'session_id')::uuid;code:=j->>'join_code';
 for i in 1..6 loop
  players[i]:=(public.same_join(code,names[i],repeat(i::text,64))->>'player_id')::uuid;
 end loop;
 assert public.same_manage(sid2,0,'lobby','configure',null,3,'0')->>'ok'='true';
 for i in 1..6 loop perform public.same_manage(sid2,0,'lobby','assign',players[i],(i+1)/2,null);end loop;
 assert public.same_host_action(sid2,0,'lobby','start')->>'ok'='true';
 for i in 1..6 loop
  perform public.same_answer(sid2,players[i],repeat(i::text,64),0,case when i<=2 then E'\tBirne\n' else names[i] end);
 end loop;
 for i in 1..6 loop perform public.same_manage(sid2,0,'reveal','reveal',players[i],null,null);end loop;
 perform public.same_host_action(sid2,0,'reveal','scores');
 assert (select points=3 from private.same_points where session_id=sid2 and team=1);
 assert (select sum(points)=3 from private.same_points where session_id=sid2);
 assert public.same_host_action(sid2,0,'leaderboard','end')->>'ok'='true';
 -- Two teams of four: a matching subgroup earns 1 even if more than two match.
 j:=public.same_create(1,array[ids[1]]);sid2:=(j->>'session_id')::uuid;code:=j->>'join_code';
 for i in 1..8 loop
  players[i]:=(public.same_join(code,'Person '||i,repeat(i::text,64))->>'player_id')::uuid;
  perform public.same_manage(sid2,0,'lobby','assign',players[i],case when i<=4 then 1 else 2 end,null);
 end loop;
 assert public.same_host_action(sid2,0,'lobby','start')->>'ok'='true';
 for i in 1..8 loop
  perform public.same_answer(sid2,players[i],repeat(i::text,64),0,case when i<=3 or i>=5 then 'Birne' else 'Orange' end);
 end loop;
 for i in 1..8 loop perform public.same_manage(sid2,0,'reveal','reveal',players[i],null,null);end loop;
 perform public.same_host_action(sid2,0,'reveal','scores');
 assert (select points=1 from private.same_points where session_id=sid2 and team=1);
 assert (select points=3 from private.same_points where session_id=sid2 and team=2);
 assert not has_table_privilege('anon','private.same_answers','SELECT');
 assert not has_table_privilege('authenticated','private.same_players','SELECT');
 assert not has_table_privilege('anon','public.same_live_signals','UPDATE');
 assert not has_function_privilege('anon','public.same_manage(uuid,integer,text,text,uuid,integer,jsonb)','EXECUTE');
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'same_%' and p.prosecdef);
end;$$;
select 'PASS: same catalogue, snapshots, ownership, teams, secrecy, reveal, immutable answers, 3/1/0, override, deadline, stale requests and permissions';
