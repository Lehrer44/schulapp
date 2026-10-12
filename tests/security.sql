-- Run after security_hardening.sql inside BEGIN/ROLLBACK. Synthetic data only.
do $test$
declare owner uuid:=gen_random_uuid(); survey uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); qsid uuid:=gen_random_uuid();
 code text:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)); qcode text:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 a jsonb; b jsonb; pid uuid; qpid uuid; token text:=repeat('a',64); other_token text:=repeat('b',64); result jsonb;
begin
 perform set_config('request.headers','{"x-forwarded-for":"security-regression-test"}',true);
 insert into auth.users(id,email) values(owner,'security-regression-'||owner::text||'@example.invalid');
 insert into public.surveys(id,owner_id,name,slides) values(survey,owner,'Security test','[{"type":"Offene Frage","question":"Test"}]');
 insert into public.sessions(id,survey_id,owner_id,title,survey_snapshot,status,current_slide,join_code)
 values(sid,survey,owner,'Security test','[{"type":"Offene Frage","question":"Test"}]','running',0,code);
 a:=public.classroom_join('survey',code,'Test participant',token,null);
 assert a->>'ok'='true','valid survey join';pid:=(a->>'participant_id')::uuid;
 b:=public.classroom_join('survey',code,'Test participant',token,null);
 assert b->>'participant_id'=pid::text,'lost join response retry must be idempotent';
 b:=public.classroom_join('survey',code,'Test participant',other_token,null);
 assert b->>'error'='NAME_TAKEN','name must not permit takeover';
 b:=public.survey_student_state(sid,pid,other_token);
 assert b->>'error'='INVALID_PARTICIPANT_TOKEN','foreign survey token rejected';
 b:=public.survey_student_state(sid,pid,null);
 assert b->>'error'='INVALID_PARTICIPANT_TOKEN','missing survey token rejected';
 b:=public.survey_submit_response(sid,pid,other_token,0,'"forged"');
 assert b->>'error'='INVALID_PARTICIPANT_TOKEN','foreign survey write rejected';
 b:=public.survey_submit_response(sid,pid,token,0,'"valid answer"');assert b->>'ok'='true','valid survey write';
 b:=public.survey_submit_response(sid,pid,token,0,'"changed answer"');assert b->>'ok'='true','idempotent survey write';
 b:=public.survey_student_state(sid,pid,token);assert b->'response'->'answer'->>'value'='valid answer','first survey answer retained';
 delete from public.responses where session_id=sid;
 b:=public.survey_student_state(sid,pid,token);assert b->'response'='null'::jsonb,'teacher reset reflected in authoritative state';
 insert into public.responses(session_id,participant_id,slide_index,answer) values(sid,pid,0,'{"value":null,"teacherMarked":true}');
 b:=public.survey_student_state(sid,pid,token);assert b->'response'->'answer'->>'teacherMarked'='true','teacher marking reflected in authoritative state';
 delete from public.responses where session_id=sid;
 b:=public.survey_submit_response(sid,pid,token,0,'{"teacherMarked":true}');assert b->>'error'='INVALID_ANSWER','student cannot supply teacher marker';
 insert into public.quiz_live_sessions(id,owner_id,quiz_title,quiz_snapshot,status,join_code,current_index,question_states)
 values(qsid,owner,'Security quiz','{"questions":[{"type":"single","points":1,"options":[{"id":"yes","text":"Yes","correct":true},{"id":"no","text":"No","correct":false}]}]}','running',qcode,0,'[{"locked":false,"revealed":false}]');
 a:=public.classroom_join('quiz',qcode,'Quiz participant',token,null);assert a->>'ok'='true','valid quiz join';qpid:=(a->>'participant_id')::uuid;
 b:=public.quiz_live_student_state_secure(qsid,qpid,other_token);assert b->>'error'='INVALID_PARTICIPANT_TOKEN','foreign quiz read rejected';
 b:=public.quiz_live_submit_response_secure(qsid,qpid,0,'"yes"',other_token);assert b->>'error'='INVALID_PARTICIPANT_TOKEN','foreign quiz write rejected';
 b:=public.quiz_live_student_state_secure(qsid,qpid,token);assert not (b->'question'->'options'->0 ? 'correct'),'unrevealed solution stays private';
 b:=public.quiz_live_submit_response_secure(qsid,qpid,0,'"yes"',token);assert b->>'ok'='true','valid quiz write';
 assert not has_function_privilege('anon','public.get_participant_session(uuid,uuid)','EXECUTE'),'legacy read revoked';
 assert not has_function_privilege('anon','public.quiz_live_submit_response(uuid,uuid,integer,jsonb)','EXECUTE'),'legacy quiz write revoked';
 assert not has_function_privilege('authenticated','public.quiz_live_join(text,text,uuid)','EXECUTE'),'legacy authenticated join revoked';
 assert not has_table_privilege('anon','public.responses','INSERT'),'direct survey write revoked';
 assert not has_function_privilege('anon','private.participant_token_valid(uuid,text,text)','EXECUTE'),'credential helper private';
 assert exists(select 1 from pg_policies where schemaname='storage' and policyname='survey_media_preserve_versions' and permissive='RESTRICTIVE'),'immutable media delete guard';
 assert exists(select 1 from pg_policies where schemaname='storage' and policyname='survey_media_no_overwrite' and permissive='RESTRICTIVE'),'immutable media update guard';
 for i in 1..121 loop result:=public.classroom_join('survey','bad','Test',token,null);end loop;
 assert result->>'error'='JOIN_RATE_LIMITED','persistent join rate limit';
 assert (select attempts>120 from private.classroom_join_limits where key='survey:ip:'||encode(sha256(convert_to('security-regression-test','UTF8')),'hex')),'error result must retain counter';
 result:=public.classroom_join('survey',code,'Another',other_token,null);
 assert result->>'error'='JOIN_RATE_LIMITED','limit checked before even a valid code lookup';
end;
$test$;
