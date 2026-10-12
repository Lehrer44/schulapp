-- Apply after security_hardening.sql.
CREATE OR REPLACE FUNCTION public.quiz_live_student_state(p_session_id uuid, p_participant_id uuid)
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
    'submitted_at',r.submitted_at
  ) into v_own_answer
  from public.quiz_live_responses r
  where r.session_id=v_session.id and r.participant_id=p_participant_id and r.question_index=v_index;

  return pg_catalog.jsonb_build_object(
    'ok',true,'session_id',v_session.id,'title',v_session.quiz_title,'status',v_session.status,
    'current_index',v_session.current_index,'question_count',v_count,'question_state',v_qstate,
    'question',v_safe_question,'own_response',v_own_answer,'leaderboard',v_leaderboard,
    'locked',coalesce((v_qstate ->> 'locked')::boolean,false),'revealed',v_revealed
  );
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
    'submitted_at',r.submitted_at
  ) into v_own_answer
  from public.quiz_live_responses r
  where r.session_id=v_session.id and r.participant_id=p_participant_id and r.question_index=v_index;

  return pg_catalog.jsonb_build_object(
    'ok',true,'session_id',v_session.id,'title',v_session.quiz_title,'status',v_session.status,
    'current_index',v_session.current_index,'question_count',v_count,'question_state',v_qstate,
    'question',v_safe_question,'own_response',v_own_answer,'leaderboard',v_leaderboard,
    'locked',coalesce((v_qstate ->> 'locked')::boolean,false),'revealed',v_revealed
  );
end;
$function$;
-- Bind delayed UI actions to the question the teacher actually saw.
create or replace function public.quiz_live_start_timer_at(p_session_id uuid,p_seconds integer,p_question_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_live_sessions%rowtype;
begin
 select * into s from public.quiz_live_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 if p_question_index is null or s.current_index<>p_question_index then return jsonb_build_object('ok',false,'error','STATE_CHANGED'); end if;
 if nullif(s.question_states->s.current_index->>'timer_deadline','') is not null and (s.question_states->s.current_index->>'timer_deadline')::timestamptz<=clock_timestamp() then return jsonb_build_object('ok',false,'error','QUESTION_LOCKED'); end if;
 if p_seconds is null then return jsonb_build_object('ok',false,'error','INVALID_TIMER'); end if;
 return public.quiz_live_start_timer(p_session_id,p_seconds);
end; $$;
create or replace function public.quiz_live_navigate_from(p_session_id uuid,p_target_index integer,p_expected_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_live_sessions%rowtype;
begin
 select * into s from public.quiz_live_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 if p_expected_index is null or p_target_index is null or s.current_index<>p_expected_index then return jsonb_build_object('ok',false,'error','STATE_CHANGED'); end if;
 return public.quiz_live_navigate(p_session_id,p_target_index);
end; $$;
revoke all on function public.quiz_live_start_timer_at(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.quiz_live_navigate_from(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.quiz_live_start_timer_at(uuid,integer,integer) to authenticated;
grant execute on function public.quiz_live_navigate_from(uuid,integer,integer) to authenticated;

-- Compare-and-swap bibliographies: only the revision that was loaded may be saved.
create table if not exists public.teacher_libraries (
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('quiz','jeopardy')),
 revision bigint not null default 0,
 payload jsonb not null,
 last_operation_id uuid,
 updated_at timestamptz not null default now(),
 primary key(owner_id,kind)
);
alter table public.teacher_libraries enable row level security;
drop policy if exists teacher_libraries_read_own on public.teacher_libraries;
create policy teacher_libraries_read_own on public.teacher_libraries for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.teacher_libraries from anon,authenticated;
grant select on public.teacher_libraries to authenticated;
create or replace function public.save_teacher_library(p_owner_id uuid,p_kind text,p_expected_revision bigint,p_operation_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.teacher_libraries%rowtype; v_revision bigint;
begin
 if auth.uid() is null or p_owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
 if p_kind is null or p_kind not in ('quiz','jeopardy') or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>52428800 then return jsonb_build_object('ok',false,'error','INVALID_LIBRARY'); end if;
 if jsonb_typeof(p_payload->(case when p_kind='quiz' then 'quizzes' else 'games' end)) is distinct from 'array' then return jsonb_build_object('ok',false,'error','INVALID_LIBRARY'); end if;
 insert into public.teacher_libraries(owner_id,kind,revision,payload) values(p_owner_id,p_kind,0,'{}') on conflict(owner_id,kind) do nothing;
 select * into s from public.teacher_libraries where owner_id=p_owner_id and kind=p_kind for update;
 if s.last_operation_id=p_operation_id then return jsonb_build_object('ok',true,'revision',s.revision); end if;
 if s.revision<>p_expected_revision then return jsonb_build_object('ok',false,'error','LIBRARY_CONFLICT','revision',s.revision); end if;
 update public.teacher_libraries set payload=p_payload,revision=revision+1,last_operation_id=p_operation_id,updated_at=now() where owner_id=p_owner_id and kind=p_kind returning revision into v_revision;
 return jsonb_build_object('ok',true,'revision',v_revision);
end; $$;
revoke all on function public.save_teacher_library(uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_teacher_library(uuid,text,bigint,uuid,jsonb) to authenticated;

create index if not exists responses_session_slide_idx on public.responses(session_id,slide_index,created_at,id);
create or replace function public.quiz_live_teacher_state(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'participant_id',r.participant_id,'question_index',r.question_index,'submitted_at',r.submitted_at,'is_correct',case when v_reveal then r.is_correct else null end,'awarded_points',case when v_reveal then r.awarded_points else 0 end,'answer',case when v_reveal then r.answer else null end) order by r.submitted_at,r.id),'[]') into v_rows
 from public.quiz_live_responses r where r.session_id=p_session_id and r.question_index=v_index;
 return jsonb_build_object('ok',true,'session',v_session,'leaderboard',v_rank,'responses',v_rows);
end; $$;
revoke all on function public.quiz_live_teacher_state(uuid) from public,anon,authenticated;
grant execute on function public.quiz_live_teacher_state(uuid) to authenticated;

create or replace function public.survey_student_state_compact(p_session_id uuid,p_participant_id uuid,p_token text,p_include_snapshot boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_session jsonb; v_response jsonb;
begin
 if not private.participant_token_valid(p_participant_id,'survey',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 select jsonb_build_object('id',s.id,'title',s.title,'survey_snapshot',case when p_include_snapshot then s.survey_snapshot else null end,'status',s.status,'current_slide',s.current_slide,'join_code',s.join_code,'updated_at',s.updated_at)
 into v_session from public.sessions s join public.participants p on p.session_id=s.id where s.id=p_session_id and p.id=p_participant_id;
 if not coalesce(p_include_snapshot,false) then v_session:=v_session-'survey_snapshot'; end if;
 if v_session is null then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;
 select jsonb_build_object('answer',r.answer,'updated_at',r.updated_at) into v_response from public.responses r
 where r.session_id=p_session_id and r.participant_id=p_participant_id and r.slide_index=(v_session->>'current_slide')::integer;
 return jsonb_build_object('ok',true,'session',v_session,'response',v_response);
end; $$;
revoke all on function public.survey_student_state_compact(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.survey_student_state_compact(uuid,uuid,text,boolean) to anon,authenticated;
notify pgrst,'reload schema';

create or replace function public.classroom_resolve_code(p_join_code text,p_kind_hint text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=upper(btrim(coalesce(p_join_code,''))); kinds jsonb:='[]';
begin
 if not private.classroom_join_allowed('entry') then return jsonb_build_object('ok',false,'error','JOIN_RATE_LIMITED'); end if;
 if code !~ '^[A-Z0-9]{5}$' then return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT'); end if;
 if (p_kind_hint is null or p_kind_hint='survey') and exists(select 1 from public.sessions where join_code=code and status in ('lobby','running')) then kinds:=kinds||'"survey"'::jsonb; end if;
 if (p_kind_hint is null or p_kind_hint='quiz') and exists(select 1 from public.quiz_live_sessions where join_code=code and status in ('lobby','running')) then kinds:=kinds||'"quiz"'::jsonb; end if;
 if jsonb_array_length(kinds)=0 then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;
 return jsonb_build_object('ok',true,'kinds',kinds);
end; $$;
revoke all on function public.classroom_resolve_code(text,text) from public,anon,authenticated;
grant execute on function public.classroom_resolve_code(text,text) to anon,authenticated;
notify pgrst,'reload schema';
