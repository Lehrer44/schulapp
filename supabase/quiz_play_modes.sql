-- Mixed live quiz rules. Apply after reliability_upgrade.sql. Existing sessions retain classic behaviour.

CREATE OR REPLACE FUNCTION public.quiz_live_create(p_quiz jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_code text;
  v_session_id uuid;
  v_questions jsonb;
  v_states jsonb;
  v_title text;
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_owner is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); end if;
  if pg_catalog.jsonb_typeof(p_quiz) <> 'object'
     or pg_catalog.jsonb_typeof(p_quiz -> 'questions') <> 'array'
     or pg_catalog.jsonb_array_length(p_quiz -> 'questions') < 1
     or pg_catalog.jsonb_array_length(p_quiz -> 'questions') > 200 then
    return jsonb_build_object('ok',false,'error','INVALID_QUIZ');
  end if;
  v_questions := p_quiz -> 'questions';
  v_title := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_quiz ->> 'title'),''),'Quiz'),160);
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('locked',false,'revealed',false,'timer_seconds',null,'timer_deadline',null) || case when p_quiz->>'rules_version'='1' then jsonb_build_object('locked',false,'opened_at',null,'mode',case when v_questions->(n-1)->>'playMode' in ('classic','buzzer','speed') then v_questions->(n-1)->>'playMode' else 'classic' end) else '{}'::jsonb end
    order by n
  ),'[]'::jsonb) into v_states
  from pg_catalog.generate_series(1,pg_catalog.jsonb_array_length(v_questions)) n;

  for attempt in 1..20 loop
    v_code := '';
    for pos in 1..5 loop
      v_code := v_code || pg_catalog.substr(v_chars, 1 + pg_catalog.floor(pg_catalog.random()*pg_catalog.length(v_chars))::int, 1);
    end loop;
    if not exists(select 1 from public.quiz_live_sessions s where s.join_code=v_code) then
      exit;
    end if;
    v_code := null;
  end loop;
  if v_code is null then return jsonb_build_object('ok',false,'error','CODE_GENERATION_FAILED'); end if;

  insert into public.quiz_live_sessions(owner_id,quiz_title,quiz_snapshot,status,join_code,current_index,question_states)
  values(v_owner,v_title,p_quiz,'lobby',v_code,-1,v_states)
  returning id into v_session_id;
  return jsonb_build_object('ok',true,'session_id',v_session_id,'join_code',v_code,'title',v_title);
end;
$function$;

CREATE OR REPLACE FUNCTION private.quiz_live_submit_response_impl(p_session_id uuid, p_participant_id uuid, p_question_index integer, p_answer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.quiz_live_sessions%rowtype;
  v_question jsonb;
  v_state jsonb;
  v_new_states jsonb;
  v_type text;
  v_ids text[];
  v_expected integer;
  v_mode text;
  v_arrived timestamptz := clock_timestamp();
  v_received timestamptz;
  v_entry uuid;
  v_existing public.quiz_live_responses%rowtype;
begin
  select * into v_session from public.quiz_live_sessions s
  where s.id=p_session_id
    and exists(select 1 from public.quiz_live_participants p where p.id=p_participant_id and p.session_id=s.id)
  for update of s;
  if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;
  if v_session.status<>'running' or p_question_index<>v_session.current_index
     or p_question_index<0 or p_question_index>=pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions') then
    return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE');
  end if;

  v_received := clock_timestamp();
  v_state := coalesce(v_session.question_states -> p_question_index,'{}'::jsonb);
  v_mode := coalesce(v_state->>'mode','classic');
  if v_mode in ('buzzer','speed') then
    select * into v_existing from public.quiz_live_responses where session_id=p_session_id and participant_id=p_participant_id and question_index=p_question_index;
    if found then return jsonb_build_object('ok',true,'already_submitted',true,'submitted_at',v_existing.submitted_at); end if;
  end if;
  if v_session.quiz_snapshot->>'rules_version'='1' and (v_state->>'opened_at' is null or v_arrived<(v_state->>'opened_at')::timestamptz) then
    return jsonb_build_object('ok',false,'error','ROUND_NOT_OPEN');
  end if;
  if coalesce((v_state ->> 'revealed')::boolean,false) or coalesce((v_state ->> 'locked')::boolean,false) then
    return jsonb_build_object('ok',false,'error','QUESTION_LOCKED');
  end if;
  if nullif(v_state ->> 'timer_deadline','') is not null and (v_state ->> 'timer_deadline')::timestamptz <= pg_catalog.clock_timestamp() then
    v_state := pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_state,'{locked}','true'::jsonb,true),'{timer_deadline}','null'::jsonb,true);
    v_new_states := pg_catalog.jsonb_set(v_session.question_states,array[p_question_index::text],v_state,true);
    update public.quiz_live_sessions set question_states=v_new_states,updated_at=pg_catalog.now() where id=v_session.id;
    return jsonb_build_object('ok',false,'error','QUESTION_LOCKED');
  end if;

  v_question := v_session.quiz_snapshot -> 'questions' -> p_question_index;
  v_type := v_question ->> 'type';
  if v_mode='buzzer' then
    if p_answer is distinct from '{"buzz":true}'::jsonb then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
  elsif v_type='single' then
    if pg_catalog.jsonb_typeof(p_answer)<>'string' or not exists(
      select 1 from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'options','[]'::jsonb)) o(value)
      where o.value ->> 'id'=p_answer #>> '{}'
    ) then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
  elsif v_type='multiple' then
    if pg_catalog.jsonb_typeof(p_answer)<>'array' or pg_catalog.jsonb_array_length(p_answer)<1 then
      return jsonb_build_object('ok',false,'error','INVALID_ANSWER');
    end if;
    if exists(
      select 1 from pg_catalog.jsonb_array_elements_text(p_answer) v(value)
      where not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'options','[]'::jsonb)) o(value) where o.value ->> 'id'=v.value)
    ) then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
    select pg_catalog.array_agg(v.value) into v_ids from pg_catalog.jsonb_array_elements_text(p_answer) v(value);
    if pg_catalog.cardinality(v_ids) <> (select count(distinct x) from pg_catalog.unnest(v_ids) x) then
      return jsonb_build_object('ok',false,'error','INVALID_ANSWER');
    end if;
  elsif v_type='truefalse' then
    if pg_catalog.jsonb_typeof(p_answer)<>'boolean' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
  elsif v_type='ranking' then
    if pg_catalog.jsonb_typeof(p_answer)<>'array' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
    select pg_catalog.array_agg(v.value order by v.ordinality) into v_ids from pg_catalog.jsonb_array_elements_text(p_answer) with ordinality v(value,ordinality);
    select pg_catalog.jsonb_array_length(coalesce(v_question -> 'items','[]'::jsonb)) into v_expected;
    if coalesce(pg_catalog.cardinality(v_ids),0)<>v_expected
       or pg_catalog.cardinality(v_ids)<>(select count(distinct x) from pg_catalog.unnest(v_ids) x)
       or exists(select 1 from pg_catalog.unnest(v_ids) x where not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'items','[]'::jsonb)) i(value) where i.value ->> 'id'=x)) then
      return jsonb_build_object('ok',false,'error','INVALID_ANSWER');
    end if;
  elsif v_type='shortanswer' then
    if pg_catalog.jsonb_typeof(p_answer)<>'string' or pg_catalog.char_length(p_answer #>> '{}')>2000
       or pg_catalog.char_length(pg_catalog.btrim(p_answer #>> '{}'))=0 then
      return jsonb_build_object('ok',false,'error','INVALID_ANSWER');
    end if;
  else return jsonb_build_object('ok',false,'error','INVALID_QUESTION_TYPE');
  end if;

  insert into public.quiz_live_responses(session_id,participant_id,question_index,answer,submitted_at,is_correct,awarded_points,evaluated_at)
  values(v_session.id,p_participant_id,p_question_index,p_answer,v_received,null,0,null)
  on conflict(session_id,participant_id,question_index) do update
    set answer=excluded.answer,submitted_at=excluded.submitted_at,is_correct=null,awarded_points=0,evaluated_at=null
  returning id into v_entry;
  if v_mode in ('buzzer','speed') and v_state->>'active_response_id' is null then
    select id into v_entry from public.quiz_live_responses where session_id=p_session_id and question_index=p_question_index and evaluated_at is null order by submitted_at,id limit 1;
    v_state := v_state || jsonb_build_object('active_response_id',v_entry,'shown_ids',coalesce(v_state->'shown_ids','[]'::jsonb)||to_jsonb(v_entry));
    update public.quiz_live_sessions set question_states=jsonb_set(question_states,array[p_question_index::text],v_state),updated_at=clock_timestamp() where id=p_session_id;
  end if;
  update public.quiz_live_participants set last_seen_at=pg_catalog.now() where id=p_participant_id;
  return jsonb_build_object('ok',true,'submitted_at',v_received);
end;
$function$;

CREATE OR REPLACE FUNCTION public.quiz_live_reveal_question(p_session_id uuid, p_question_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.quiz_live_sessions%rowtype;
  v_state jsonb;
  v_states jsonb;
  v_question jsonb;
  v_row record;
  v_correct boolean;
  v_points numeric(10,2);
begin
  select * into v_session from public.quiz_live_sessions where id=p_session_id for update;
  if not found or v_session.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
  if p_question_index<0 or p_question_index>=pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions')
     or p_question_index<>v_session.current_index or v_session.status<>'running' then
    return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE');
  end if;
  v_state := coalesce(v_session.question_states -> p_question_index,'{}'::jsonb);
  if coalesce((v_state ->> 'revealed')::boolean,false) then return jsonb_build_object('ok',true,'already_revealed',true); end if;

  v_state := pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_state,'{locked}','true'::jsonb,true),'{revealed}','true'::jsonb,true),'{timer_deadline}','null'::jsonb,true);
  v_states := pg_catalog.jsonb_set(v_session.question_states,array[p_question_index::text],v_state,true);
  update public.quiz_live_sessions set question_states=v_states,updated_at=pg_catalog.now() where id=p_session_id;

  v_question := v_session.quiz_snapshot -> 'questions' -> p_question_index;
  v_points := greatest(0,coalesce((v_question ->> 'points')::numeric,0));
  for v_row in select r.id,r.answer from public.quiz_live_responses r
    where r.session_id=p_session_id and r.question_index=p_question_index
  loop
    v_correct := case when coalesce(v_state->>'mode','classic') in ('buzzer','speed') then false else private.quiz_live_is_correct(v_question,v_row.answer) end;
    update public.quiz_live_responses
      set is_correct=v_correct,awarded_points=case when v_correct then v_points else 0 end,evaluated_at=pg_catalog.now()
      where id=v_row.id;
  end loop;
  return jsonb_build_object('ok',true,'already_revealed',false);
end;
$function$;

CREATE OR REPLACE FUNCTION private.quiz_live_student_state_impl(p_session_id uuid, p_participant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.quiz_live_sessions%rowtype;
  v_question jsonb;
  v_safe_question jsonb;
  v_options jsonb;
  v_items jsonb;
  v_qstate jsonb;
  v_states jsonb;
  v_index integer;
  v_revealed boolean := false;
  v_own_answer jsonb := null;
  v_leaderboard jsonb;
  v_count integer;
begin
  select * into v_session from public.quiz_live_sessions s
  where s.id=p_session_id
    and exists(select 1 from public.quiz_live_participants p where p.id=p_participant_id and p.session_id=s.id);
  if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;

  update public.quiz_live_participants set last_seen_at=pg_catalog.now()
    where id=p_participant_id and session_id=p_session_id and last_seen_at < pg_catalog.now()-interval '30 seconds';

  v_index := v_session.current_index;
  v_count := pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions');
  v_qstate := case when v_index>=0 and v_index<v_count then coalesce(v_session.question_states -> v_index,'{}'::jsonb) else '{}'::jsonb end;

  -- Reads compute expiry without mutating the shared question state.
  -- All state-changing teacher actions and submissions lock the session row.
  if v_index>=0 and v_index<v_count
     and not coalesce((v_qstate ->> 'revealed')::boolean,false)
     and nullif(v_qstate ->> 'timer_deadline','') is not null
     and (v_qstate ->> 'timer_deadline')::timestamptz <= pg_catalog.clock_timestamp() then
    v_qstate := pg_catalog.jsonb_set(v_qstate,'{locked}','true'::jsonb,true);
  end if;

  v_revealed := coalesce((v_qstate ->> 'revealed')::boolean,false);
  v_safe_question := null;
  if v_session.status='running' and v_index>=0 and v_index<v_count then
    v_question := v_session.quiz_snapshot -> 'questions' -> v_index;
    v_safe_question := v_question - 'text' - 'description' - 'answers' - 'correct' - 'correctOrder' - 'media';
    if v_question ->> 'type' in ('single','multiple') then
      select coalesce(pg_catalog.jsonb_agg(
        case when v_revealed then o.value else o.value - 'correct' end order by o.ordinality
      ),'[]'::jsonb) into v_options
      from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'options','[]'::jsonb))
        with ordinality o(value, ordinality);
      v_safe_question := v_safe_question || pg_catalog.jsonb_build_object('options',v_options);
    elsif v_question ->> 'type'='ranking' then
      select coalesce(pg_catalog.jsonb_agg(o.value order by pg_catalog.md5(p_participant_id::text || (o.value ->> 'id'))),'[]'::jsonb)
        into v_items
      from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'items','[]'::jsonb)) o(value);
      v_safe_question := v_safe_question || pg_catalog.jsonb_build_object('items',v_items);
      if v_revealed then
        select coalesce(pg_catalog.jsonb_agg(i.value ->> 'id' order by i.ordinality),'[]'::jsonb) into v_options
        from pg_catalog.jsonb_array_elements(coalesce(v_question -> 'items','[]'::jsonb))
          with ordinality i(value,ordinality);
        v_safe_question := v_safe_question || pg_catalog.jsonb_build_object('correctOrder',v_options);
      end if;
    elsif v_question ->> 'type'='truefalse' and v_revealed then
      v_safe_question := v_safe_question || pg_catalog.jsonb_build_object('correct',v_question -> 'correct');
    elsif v_question ->> 'type'='shortanswer' and v_revealed then
      v_safe_question := v_safe_question || pg_catalog.jsonb_build_object('answers',coalesce(v_question -> 'answers','[]'::jsonb));
    end if;
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'name',p.name,
      'score',coalesce(sc.score,0),
      'answered',case when v_index>=0 and v_index<v_count then exists(
        select 1 from public.quiz_live_responses r where r.session_id=v_session.id
          and r.participant_id=p.id and r.question_index=v_index
      ) else false end
    ) order by coalesce(sc.score,0) desc, pg_catalog.lower(p.name)
  ),'[]'::jsonb) into v_leaderboard
  from public.quiz_live_participants p
  left join lateral (
    select coalesce(pg_catalog.sum(r.awarded_points),0) as score
    from public.quiz_live_responses r where r.session_id=v_session.id and r.participant_id=p.id
  ) sc on true
  where p.session_id=v_session.id;

  select pg_catalog.jsonb_build_object(
    'answer',r.answer,'is_correct',case when v_revealed then r.is_correct else null end,
    'awarded_points',case when v_revealed then r.awarded_points else 0 end,
    'submitted_at',r.submitted_at,'reviewed',r.evaluated_at is not null
  ) into v_own_answer
  from public.quiz_live_responses r
  where r.session_id=v_session.id and r.participant_id=p_participant_id and r.question_index=v_index;

  return pg_catalog.jsonb_build_object(
    'ok',true,'session_id',v_session.id,'title',v_session.quiz_title,'status',v_session.status,
    'current_index',v_session.current_index,'question_count',v_count,'question_state',v_qstate,
    'play_mode',coalesce(v_qstate->>'mode','classic'),'round_open',case when v_session.quiz_snapshot->>'rules_version'='1' then v_qstate->>'opened_at' is not null else true end,'elapsed_ms',case when v_own_answer is not null and v_qstate->>'opened_at' is not null then greatest(0,extract(epoch from ((v_own_answer->>'submitted_at')::timestamptz-(v_qstate->>'opened_at')::timestamptz))*1000) else null end,
    'question',v_safe_question,'own_response',v_own_answer,'leaderboard',v_leaderboard,
    'locked',coalesce((v_qstate ->> 'locked')::boolean,false),'revealed',v_revealed
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.quiz_live_teacher_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_session jsonb; v_rank jsonb; v_rows jsonb; v_index integer; v_reveal boolean;
begin
 select owner_id into v_owner from public.quiz_live_sessions where id=p_session_id;
 if v_owner is null or v_owner is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 select jsonb_build_object('id',id,'quiz_title',quiz_title,'status',status,'current_index',current_index,'question_states',question_states,'updated_at',updated_at),current_index,coalesce((question_states->current_index->>'revealed')::boolean,false)
 into v_session,v_index,v_reveal from public.quiz_live_sessions where id=p_session_id;
 if nullif(v_session->'question_states'->v_index->>'timer_deadline','') is not null and not v_reveal and (v_session->'question_states'->v_index->>'timer_deadline')::timestamptz<=clock_timestamp() then v_session:=jsonb_set(v_session,array['question_states',v_index::text,'locked'],'true',true); end if;
 select coalesce(jsonb_agg(jsonb_build_object('participant',jsonb_build_object('id',p.id,'name',p.name),'score',p.score,'answered',p.answered) order by p.score desc,lower(p.name),p.id),'[]') into v_rank
 from (select p.id,p.name,coalesce(sum(r.awarded_points),0) as score,coalesce(bool_or(r.question_index=v_index),false) as answered
 from public.quiz_live_participants p left join public.quiz_live_responses r on r.participant_id=p.id and r.session_id=p.session_id
 where p.session_id=p_session_id group by p.id,p.name) p;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'participant_id',r.participant_id,'question_index',r.question_index,'submitted_at',r.submitted_at,'is_correct',case when v_reveal or r.evaluated_at is not null then r.is_correct else null end,'awarded_points',case when v_reveal or r.evaluated_at is not null then r.awarded_points else 0 end,'answer',case when coalesce(v_session->'question_states'->v_index->>'mode','classic')='classic' and v_reveal or coalesce(v_session->'question_states'->v_index->'shown_ids','[]'::jsonb) ? r.id::text then r.answer else null end,'reviewed',r.evaluated_at is not null) order by r.submitted_at,r.id),'[]') into v_rows
 from public.quiz_live_responses r where r.session_id=p_session_id and r.question_index=v_index;
 return jsonb_build_object('ok',true,'session',v_session,'leaderboard',v_rank,'responses',v_rows);
end; $function$;
create or replace function public.quiz_live_judge_entry(p_session_id uuid,p_question_index integer,p_response_id uuid,p_correct boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_live_sessions%rowtype; st jsonb; entry public.quiz_live_responses%rowtype; next_id uuid; pts numeric;
begin
 select * into s from public.quiz_live_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 if s.status<>'running' or s.current_index<>p_question_index then return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE'); end if;
 st:=s.question_states->p_question_index;
 if p_correct is null or coalesce(st->>'mode','classic') not in ('buzzer','speed') or coalesce((st->>'revealed')::boolean,false) or st->>'active_response_id' is distinct from p_response_id::text then return jsonb_build_object('ok',false,'error','STATE_CHANGED'); end if;
 select * into entry from public.quiz_live_responses where id=p_response_id and session_id=s.id and question_index=p_question_index and evaluated_at is null;
 if not found then return jsonb_build_object('ok',false,'error','STATE_CHANGED'); end if;
 pts:=greatest(0,coalesce((s.quiz_snapshot->'questions'->p_question_index->>'points')::numeric,0));
 update public.quiz_live_responses set is_correct=p_correct,awarded_points=case when p_correct then pts else 0 end,evaluated_at=clock_timestamp() where id=entry.id;
 st:=st || jsonb_build_object('active_response_id',null);
 if p_correct then
   st:=st || jsonb_build_object('winner_id',entry.participant_id,'revealed',true,'locked',true);
   update public.quiz_live_responses set is_correct=false,awarded_points=0,evaluated_at=clock_timestamp() where session_id=s.id and question_index=p_question_index and evaluated_at is null;
 else
   select id into next_id from public.quiz_live_responses where session_id=s.id and question_index=p_question_index and evaluated_at is null order by submitted_at,id limit 1;
   if next_id is null then
     if coalesce((st->>'locked')::boolean,false) or (st->>'timer_deadline')::timestamptz<=clock_timestamp() then st:=st || jsonb_build_object('revealed',true,'locked',true); end if;
   else st:=st || jsonb_build_object('active_response_id',next_id,'shown_ids',coalesce(st->'shown_ids','[]'::jsonb)||to_jsonb(next_id)); end if;
 end if;
 update public.quiz_live_sessions set question_states=jsonb_set(question_states,array[p_question_index::text],st),updated_at=clock_timestamp() where id=s.id;
 return jsonb_build_object('ok',true);
end; $$;

revoke all on function public.quiz_live_judge_entry(uuid,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.quiz_live_judge_entry(uuid,integer,uuid,boolean) to authenticated;
drop function if exists public.quiz_live_set_round_mode(uuid,integer,text);
drop function if exists public.quiz_live_open_round(uuid,integer);
drop function if exists public.quiz_live_begin_review(uuid,integer);

revoke all on function private.quiz_live_submit_response_impl(uuid,uuid,integer,jsonb),private.quiz_live_student_state_impl(uuid,uuid) from public,anon,authenticated;
revoke all on function public.quiz_live_teacher_state(uuid) from public,anon,authenticated;
grant execute on function public.quiz_live_teacher_state(uuid) to authenticated;


create or replace function public.quiz_live_start(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_live_sessions%rowtype; idx integer; st jsonb; entry uuid;
begin
 select * into s from public.quiz_live_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 if s.status='lobby' then idx:=0;
 elsif s.status='running' and s.quiz_snapshot->>'rules_version'='1' then idx:=s.current_index;
 else return jsonb_build_object('ok',false,'error','INVALID_STATUS'); end if;
 st:=s.question_states->idx;
 if s.quiz_snapshot->>'rules_version'='1' and st->>'opened_at' is null and not coalesce((st->>'revealed')::boolean,false) then
   st:=st || jsonb_build_object('opened_at',clock_timestamp(),'locked',false);
 end if;
 if st->>'mode' in ('buzzer','speed') and st->>'active_response_id' is null and not coalesce((st->>'revealed')::boolean,false) then
   select id into entry from public.quiz_live_responses where session_id=s.id and question_index=idx and evaluated_at is null order by submitted_at,id limit 1;
   if entry is not null then st:=st || jsonb_build_object('active_response_id',entry,'shown_ids',coalesce(st->'shown_ids','[]'::jsonb)||to_jsonb(entry)); end if;
 end if;
 update public.quiz_live_sessions set status='running',current_index=idx,question_states=jsonb_set(question_states,array[idx::text],st),updated_at=clock_timestamp() where id=s.id;
 return jsonb_build_object('ok',true,'current_index',idx);
end; $$;

CREATE OR REPLACE FUNCTION public.quiz_live_navigate(p_session_id uuid, p_target_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.quiz_live_sessions%rowtype;
  v_count integer;
  v_state jsonb;
begin
  select * into v_session from public.quiz_live_sessions where id=p_session_id for update;
  if not found or v_session.owner_id is distinct from auth.uid() then
    return jsonb_build_object('ok',false,'error','NOT_OWNER');
  end if;

  v_count := pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions');
  if p_target_index<0 or p_target_index>v_count then
    return jsonb_build_object('ok',false,'error','INVALID_INDEX');
  end if;

  -- Forward navigation is allowed only one step at a time, after the current solution was revealed.
  -- Moving backward never changes responses or awarded points.
  if p_target_index > v_session.current_index then
    if p_target_index <> v_session.current_index + 1 then
      return jsonb_build_object('ok',false,'error','NEXT_STEP_ONLY');
    end if;
    if v_session.current_index < 0 or v_session.current_index >= v_count then
      return jsonb_build_object('ok',false,'error','INVALID_INDEX');
    end if;
    v_state := coalesce(v_session.question_states -> v_session.current_index,'{}'::jsonb);
    if coalesce((v_state ->> 'revealed')::boolean,false) is not true then
      return jsonb_build_object('ok',false,'error','REVEAL_BEFORE_NEXT');
    end if;
  end if;

  if p_target_index=v_count then
    update public.quiz_live_sessions
      set status='ended',current_index=v_count,ended_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=p_session_id;
  else
    v_state:=v_session.question_states->p_target_index;
    if v_session.quiz_snapshot->>'rules_version'='1' and v_state->>'opened_at' is null and not coalesce((v_state->>'revealed')::boolean,false) then
      v_state:=v_state || jsonb_build_object('opened_at',clock_timestamp(),'locked',false);
      v_session.question_states:=jsonb_set(v_session.question_states,array[p_target_index::text],v_state);
    end if;
    update public.quiz_live_sessions
      set status='running',current_index=p_target_index,question_states=v_session.question_states,ended_at=null,updated_at=clock_timestamp()
      where id=p_session_id;
  end if;
  return jsonb_build_object('ok',true,'current_index',p_target_index);
end;
$function$;

revoke all on function public.quiz_live_start(uuid),public.quiz_live_navigate(uuid,integer) from public,anon,authenticated;
grant execute on function public.quiz_live_start(uuid),public.quiz_live_navigate(uuid,integer) to authenticated;
