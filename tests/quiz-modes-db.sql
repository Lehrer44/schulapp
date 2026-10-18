\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
\ir ../supabase/quiz_live_schema.sql
create table private.test_tokens(id uuid primary key,token text);
create function private.participant_token_valid(p_id uuid,p_kind text,p_token text) returns boolean language sql stable as $$select p_kind='quiz' and exists(select 1 from private.test_tokens where id=p_id and token=p_token)$$;
create function public.quiz_live_submit_response_secure(p_session_id uuid,p_participant_id uuid,p_question_index integer,p_answer jsonb,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.participant_token_valid(p_participant_id,'quiz',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 return private.quiz_live_submit_response_impl(p_session_id,p_participant_id,p_question_index,p_answer);
end;$$;
create function public.quiz_live_student_state_secure(p_session_id uuid,p_participant_id uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.participant_token_valid(p_participant_id,'quiz',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 return private.quiz_live_student_state_impl(p_session_id,p_participant_id);
end;$$;
revoke all on function public.quiz_live_submit_response_secure(uuid,uuid,integer,jsonb,text),public.quiz_live_student_state_secure(uuid,uuid,text) from public;
grant execute on function public.quiz_live_submit_response_secure(uuid,uuid,integer,jsonb,text),public.quiz_live_student_state_secure(uuid,uuid,text) to anon,authenticated;
\ir ../supabase/quiz_play_modes.sql

create table public.test_fixture(session_id uuid,a uuid,b uuid,c uuid);
do $$
declare owner_id uuid:=gen_random_uuid(); sid uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); j jsonb; first_id uuid; next_id uuid; stamp timestamptz; r jsonb;
begin
 insert into auth.users values(owner_id);perform set_config('request.jwt.claim.sub',owner_id::text,false);
 j:=public.quiz_live_create('{"title":"Mixed","rules_version":1,"questions":[{"type":"shortanswer","text":"Secret question","answers":["4"],"points":5,"playMode":"buzzer"},{"type":"shortanswer","text":"Second","answers":["4"],"points":5,"playMode":"speed"},{"type":"shortanswer","text":"Third","answers":["4"],"points":3,"playMode":"classic"}]}'::jsonb);
 assert (j->>'ok')::boolean,j::text;sid:=(j->>'session_id')::uuid;
 assert (select question_states->0->>'mode'='buzzer' and question_states->1->>'mode'='speed' and question_states->2->>'mode'='classic' from public.quiz_live_sessions where id=sid);
 insert into public.quiz_live_participants(id,session_id,name) values(a,sid,'A'),(b,sid,'B'),(c,sid,'C');
 insert into private.test_tokens values(a,'a'),(b,'b'),(c,'c');
 assert public.quiz_live_submit_response_secure(sid,a,0,'{"buzz":true}','a')->>'error'='QUESTION_NOT_ACTIVE';
 assert public.quiz_live_student_state_secure(sid,a,'a')->'question'='null'::jsonb;
 assert public.quiz_live_start(sid)->>'ok'='true';
 assert (select question_states->0->>'opened_at' is not null and not (question_states->0->>'locked')::boolean from public.quiz_live_sessions where id=sid);
 assert public.quiz_live_submit_response_secure(sid,a,0,'{"buzz":true}','wrong')->>'error'='INVALID_PARTICIPANT_TOKEN';
 select (question_states->0->>'opened_at')::timestamptz into stamp from public.quiz_live_sessions where id=sid;
 assert public.quiz_live_start(sid)->>'ok'='true';
 assert (select (question_states->0->>'opened_at')::timestamptz=stamp from public.quiz_live_sessions where id=sid);
 assert public.quiz_live_submit_response_secure(sid,a,0,'{"buzz":true}','a')->>'ok'='true';
 select id,submitted_at into first_id,stamp from public.quiz_live_responses where session_id=sid and participant_id=a;
 assert public.quiz_live_submit_response_secure(sid,a,0,'{"buzz":true}','a')->>'already_submitted'='true';
 assert (select submitted_at=stamp from public.quiz_live_responses where id=first_id);
 assert public.quiz_live_submit_response_secure(sid,b,0,'{"buzz":true}','b')->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,c,0,'{"buzz":true}','c')->>'ok'='true';

 j:=public.quiz_live_teacher_state(sid);assert j->'session'->'question_states'->0->>'active_response_id'=first_id::text;
 assert j->'responses'->0->'answer'='{"buzz":true}'::jsonb and j->'responses'->1->'answer'='null'::jsonb;
 assert public.quiz_live_judge_entry(sid,0,first_id,false)->>'ok'='true';
 assert public.quiz_live_judge_entry(sid,0,first_id,true)->>'error'='STATE_CHANGED';
 select id into next_id from public.quiz_live_responses where session_id=sid and participant_id=b and question_index=0;
 assert public.quiz_live_judge_entry(sid,0,next_id,true)->>'ok'='true';
 assert (select sum(awarded_points)=5 from public.quiz_live_responses where session_id=sid);
 assert public.quiz_live_reveal_question(sid,0)->>'already_revealed'='true';
 assert (select sum(awarded_points)=5 from public.quiz_live_responses where session_id=sid);

 assert public.quiz_live_navigate(sid,1)->>'ok'='true';
 assert (select question_states->1->>'opened_at' is not null and not (question_states->1->>'locked')::boolean from public.quiz_live_sessions where id=sid);
 assert public.quiz_live_submit_response_secure(sid,a,1,'"wrong"','a')->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,a,1,'"4"','a')->>'already_submitted'='true';
 assert (select answer='"wrong"'::jsonb from public.quiz_live_responses where session_id=sid and participant_id=a and question_index=1);
 assert public.quiz_live_submit_response_secure(sid,b,1,'"4"','b')->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,c,1,'"4"','c')->>'ok'='true';
 j:=public.quiz_live_student_state_secure(sid,a,'a');assert not (j->'question' ? 'text') and not (j->'question' ? 'answers');assert j->>'round_open'='true';
 j:=public.quiz_live_teacher_state(sid);assert j->'responses'->0->'answer'='"wrong"'::jsonb and j->'responses'->1->'answer'='null'::jsonb;

 select id into first_id from public.quiz_live_responses where session_id=sid and participant_id=a and question_index=1;
 assert public.quiz_live_judge_entry(sid,1,first_id,false)->>'ok'='true';
 j:=public.quiz_live_teacher_state(sid);assert j->'responses'->1->'answer'='"4"'::jsonb and j->'responses'->2->'answer'='null'::jsonb;
 select id into next_id from public.quiz_live_responses where session_id=sid and participant_id=b and question_index=1;
 assert public.quiz_live_judge_entry(sid,1,next_id,true)->>'ok'='true';
 assert (select sum(awarded_points)=10 from public.quiz_live_responses where session_id=sid and participant_id=b);
 assert (select sum(awarded_points)=0 from public.quiz_live_responses where session_id=sid and participant_id=c);

 assert public.quiz_live_navigate(sid,2)->>'ok'='true';
 assert (select question_states->2->>'opened_at' is not null from public.quiz_live_sessions where id=sid);
 assert public.quiz_live_submit_response_secure(sid,b,2,'"4"','b')->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,c,2,'"wrong"','c')->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,c,2,'"4"','c')->>'ok'='true';
 assert public.quiz_live_reveal_question(sid,2)->>'ok'='true';
 assert (select sum(awarded_points)=3 from public.quiz_live_responses where session_id=sid and participant_id=c);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,false);
 assert public.quiz_live_teacher_state(sid)->>'error'='NOT_OWNER';
 assert public.quiz_live_judge_entry(sid,2,next_id,true)->>'error'='NOT_OWNER';
 assert not has_function_privilege('anon','public.quiz_live_judge_entry(uuid,integer,uuid,boolean)','execute');
 assert to_regprocedure('public.quiz_live_open_round(uuid,integer)') is null;
 assert to_regprocedure('public.quiz_live_set_round_mode(uuid,integer,text)') is null;
 assert to_regprocedure('public.quiz_live_begin_review(uuid,integer)') is null;

 -- Old clients/sessions stay classic and may answer immediately after starting.
 perform set_config('request.jwt.claim.sub',owner_id::text,false);
 j:=public.quiz_live_create('{"questions":[{"type":"truefalse","correct":true,"points":1}]}');sid:=(j->>'session_id')::uuid;
 insert into public.quiz_live_participants(id,session_id,name) values(gen_random_uuid(),sid,'Legacy') returning id into first_id;
 insert into private.test_tokens values(first_id,'legacy');
 assert public.quiz_live_start(sid)->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,first_id,0,'true','legacy')->>'ok'='true';
 assert public.quiz_live_reveal_question(sid,0)->>'ok'='true';
 assert (select awarded_points=1 from public.quiz_live_responses where session_id=sid);

 -- Exhausted race queue ends with zero points; no hidden answer is auto-awarded.
 j:=public.quiz_live_create('{"rules_version":1,"questions":[{"playMode":"speed","type":"shortanswer","answers":["4"],"points":2}]}');sid:=(j->>'session_id')::uuid;
 a:=gen_random_uuid();b:=gen_random_uuid();insert into public.quiz_live_participants(id,session_id,name) values(a,sid,'Wrong A'),(b,sid,'Wrong B');insert into private.test_tokens values(a,'a'),(b,'b');
 assert public.quiz_live_start(sid)->>'ok'='true';
 assert public.quiz_live_submit_response_secure(sid,a,0,'"wrong"','a')->>'ok'='true';assert public.quiz_live_submit_response_secure(sid,b,0,'"wrong"','b')->>'ok'='true';

 select id into first_id from public.quiz_live_responses where session_id=sid and participant_id=a;
 select id into next_id from public.quiz_live_responses where session_id=sid and participant_id=b;
 assert public.quiz_live_judge_entry(sid,0,first_id,false)->>'ok'='true';assert public.quiz_live_judge_entry(sid,0,next_id,false)->>'ok'='true';
 assert (select not (question_states->0->>'revealed')::boolean and question_states->0->>'active_response_id' is null from public.quiz_live_sessions where id=sid);
 c:=gen_random_uuid();insert into public.quiz_live_participants(id,session_id,name) values(c,sid,'Later');insert into private.test_tokens values(c,'later');
 assert public.quiz_live_submit_response_secure(sid,c,0,'"4"','later')->>'ok'='true';
 select id into next_id from public.quiz_live_responses where session_id=sid and participant_id=c;
 assert public.quiz_live_judge_entry(sid,0,next_id,false)->>'ok'='true';
 assert public.quiz_live_lock_question(sid,0)->>'ok'='true';
 assert public.quiz_live_reveal_question(sid,0)->>'ok'='true';
 assert (select sum(awarded_points)=0 from public.quiz_live_responses where session_id=sid);

 -- A server deadline rejects late submissions even if a phone has not polled yet.
 j:=public.quiz_live_create('{"rules_version":1,"questions":[{"playMode":"speed","type":"shortanswer","answers":["4"],"points":2}]}');sid:=(j->>'session_id')::uuid;
 a:=gen_random_uuid();insert into public.quiz_live_participants(id,session_id,name) values(a,sid,'Late');insert into private.test_tokens values(a,'late');
 assert public.quiz_live_start(sid)->>'ok'='true';
 update public.quiz_live_sessions set question_states=jsonb_set(question_states,'{0,timer_deadline}',to_jsonb(clock_timestamp()-interval '1 second')) where id=sid;
 assert public.quiz_live_submit_response_secure(sid,a,0,'"4"','late')->>'error'='QUESTION_LOCKED';
 assert (select count(*)=0 from public.quiz_live_responses where session_id=sid);

 -- Leave an isolated open round for the parallel-submission test.
 j:=public.quiz_live_create('{"rules_version":1,"questions":[{"playMode":"speed","type":"shortanswer","answers":["4"],"points":1}]}');sid:=(j->>'session_id')::uuid;
 a:=gen_random_uuid();b:=gen_random_uuid();c:=gen_random_uuid();
 insert into public.quiz_live_participants(id,session_id,name) values(a,sid,'Parallel A'),(b,sid,'Parallel B'),(c,sid,'Parallel C');
 insert into private.test_tokens values(a,'a'),(b,'b'),(c,'c');
 assert public.quiz_live_start(sid)->>'ok'='true';
 insert into public.test_fixture values(sid,a,b,c);
end;$$;
select 'PASS: mixed modes, automatic starts, immutable first entries, staged disclosure, one winner, stale actions, auth, tokens, classic compatibility';

