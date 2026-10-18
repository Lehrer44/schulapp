begin;
-- Run inside a transaction; fixtures use synthetic IDs and are rolled back.
do $$
declare owner_id uuid:=gen_random_uuid(); sid uuid; pid uuid:=gen_random_uuid(); pid2 uuid:=gen_random_uuid(); pid3 uuid:=gen_random_uuid(); j jsonb; q jsonb; original_score numeric;
begin
 insert into auth.users(id) values(owner_id);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 q:='{"type":"pin","text":"Find the place","points":3,"playMode":"speed","pinAspect":2,"pinTarget":{"x":50,"y":50,"radius":10},"media":{"type":"image","data":"data:image/png;base64,AAAA"}}';
 assert private.quiz_live_is_correct(q,'{"x":60,"y":50}');
 assert private.quiz_live_is_correct(q,'{"x":50,"y":70}');
 assert not private.quiz_live_is_correct(q,'{"x":50,"y":70.01}');
 assert not private.quiz_live_is_correct(q,'{"x":60.01,"y":50}');
 assert not private.quiz_live_is_correct(q,'{"x":"50","y":50}');
 j:=public.quiz_live_create(jsonb_build_object('title','Synthetic pin test','rules_version',1,'questions',jsonb_build_array(q)));
 assert j->>'ok'='true',j::text;sid:=(j->>'session_id')::uuid;
 assert (select question_states->0->>'mode'='classic' from public.quiz_live_sessions where id=sid);
 insert into public.quiz_live_participants(id,session_id,name) values(pid,sid,'Synthetic A'),(pid2,sid,'Synthetic B'),(pid3,sid,'Synthetic C');
 assert public.quiz_live_start(sid)->>'ok'='true';
 j:=private.quiz_live_student_state_impl(sid,pid);
 assert not (j->'question'?'pinTarget');assert j->'question'->>'text'='Find the place';assert j->'question'->'media'->>'type'='image';
 assert private.quiz_live_submit_response_impl(sid,pid,0,'{"x":50,"y":50,"awarded_points":999}')->>'ok'='true';
 assert private.quiz_live_submit_response_impl(sid,pid2,0,'{"x":50,"y":70}')->>'ok'='true';
 assert private.quiz_live_submit_response_impl(sid,pid3,0,'{"x":50,"y":70.01}')->>'ok'='true';
 assert private.quiz_live_submit_response_impl(sid,pid,0,'{"x":-1,"y":0}')->>'error'='INVALID_ANSWER';
 assert private.quiz_live_submit_response_impl(sid,pid,0,'{"x":"50","y":50}')->>'error'='INVALID_ANSWER';
 assert private.quiz_live_submit_response_impl(sid,pid,null,'{"x":50,"y":50}')->>'error'='QUESTION_NOT_ACTIVE';
 assert (select answer='{"x":50,"y":50}'::jsonb from public.quiz_live_responses where participant_id=pid);
 assert public.quiz_live_reveal_question(sid,0)->>'ok'='true';
 assert (select count(*)=2 from public.quiz_live_responses where session_id=sid and awarded_points=3);
 assert (select awarded_points=0 from public.quiz_live_responses where participant_id=pid3);
 assert private.quiz_live_student_state_impl(sid,pid)->'question'?'pinTarget';
 assert public.quiz_live_reveal_question(sid,0)->>'already_revealed'='true';
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 assert public.quiz_live_end(sid)->>'error'='NOT_OWNER';
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 assert public.quiz_live_end(sid)->>'ok'='true';assert public.quiz_live_end(sid)->>'ok'='true';
 assert (select status='ended' and ended_at is not null from public.quiz_live_sessions where id=sid);
 assert public.quiz_live_navigate(sid,0)->>'error'='SESSION_ENDED';
 assert private.quiz_live_submit_response_impl(sid,pid,0,'{"x":50,"y":50}')->>'error'='QUESTION_NOT_ACTIVE';
 assert (select sum(awarded_points)=6 from public.quiz_live_responses where session_id=sid);
 assert not has_function_privilege('anon','public.quiz_live_end(uuid)','execute');
 assert has_function_privilege('authenticated','public.quiz_live_end(uuid)','execute');
 assert not has_function_privilege('authenticated','private.quiz_pin_point(jsonb)','execute');
 assert public.quiz_live_create(jsonb_build_object('questions',jsonb_build_array(q-'pinTarget')))->>'error'='INVALID_PIN_QUESTION';
 -- Ending in the lobby also works without starting or awarding answers.
 j:=public.quiz_live_create('{"questions":[{"type":"truefalse","correct":true,"points":1}]}');sid:=(j->>'session_id')::uuid;
 assert public.quiz_live_end(sid)->>'ok'='true';
 assert (select status='ended' from public.quiz_live_sessions where id=sid);
end;$$;

rollback;
