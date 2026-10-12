-- Apply after schema.sql and quiz_live_schema.sql. Idempotent security upgrade.
-- Existing participants without a token must join again with a new display name.
create schema if not exists private;
create table if not exists private.participant_credentials (
 participant_id uuid primary key, kind text not null check(kind in ('survey','quiz')),
 token_hash text not null, created_at timestamptz not null default now()
);
alter table private.participant_credentials enable row level security;
revoke all on private.participant_credentials from public,anon,authenticated;
create table if not exists private.classroom_join_limits (
 key text primary key, window_start timestamptz not null, attempts integer not null
);
alter table private.classroom_join_limits enable row level security;
revoke all on private.classroom_join_limits from public,anon,authenticated;

create or replace function private.participant_token_valid(p_id uuid,p_kind text,p_token text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_token ~ '^[a-f0-9]{64}$',false) and exists (
 select 1 from private.participant_credentials c where c.participant_id=p_id and c.kind=p_kind
 and c.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex'));
$$;

-- Header-independent global ceiling prevents bypass by supplying different IP headers.
-- IP bucket allows a whole class behind NAT; both buckets count attempts BEFORE lookup.
create or replace function private.classroom_join_allowed(p_kind text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_headers jsonb; v_ip text; v_count integer; v_global integer;
begin
 v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 v_ip:=coalesce(nullif(split_part(v_headers->>'x-forwarded-for',',',1),''),'unknown');
 insert into private.classroom_join_limits as r(key,window_start,attempts)
 values(p_kind||':global',clock_timestamp(),1)
 on conflict(key) do update set
 attempts=case when r.window_start<clock_timestamp()-interval '1 minute' then 1 else r.attempts+1 end,
 window_start=case when r.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else r.window_start end
 returning attempts into v_global;
 if v_global>600 then return false; end if;
 insert into private.classroom_join_limits as r(key,window_start,attempts)
 values(p_kind||':ip:'||encode(sha256(convert_to(v_ip,'UTF8')),'hex'),clock_timestamp(),1)
 on conflict(key) do update set
 attempts=case when r.window_start<clock_timestamp()-interval '1 minute' then 1 else r.attempts+1 end,
 window_start=case when r.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else r.window_start end
 returning attempts into v_count;
 return v_count<=120;
end; $$;

create or replace function public.classroom_join(p_kind text,p_join_code text,p_name text,p_token text,p_participant_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sid uuid; v_pid uuid; v_name text:=btrim(coalesce(p_name,'')); v_code text:=upper(btrim(coalesce(p_join_code,''))); v_title text;
begin
 if p_kind is null or p_kind not in ('survey','quiz') then return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT'); end if;
 if not private.classroom_join_allowed(p_kind) then return jsonb_build_object('ok',false,'error','JOIN_RATE_LIMITED'); end if;
 if v_code !~ '^[A-Z0-9]{5}$' or length(v_name) not between 1 and 40 or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
 return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT'); end if;
 if p_kind='survey' then
 select s.id,s.title into v_sid,v_title from public.sessions s where s.join_code=v_code and s.status in ('lobby','running') for update;
 else
 select s.id,s.quiz_title into v_sid,v_title from public.quiz_live_sessions s where s.join_code=v_code and s.status in ('lobby','running') for update;
 end if;
 if v_sid is null then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;
 if p_kind='survey' then
 select id into v_pid from public.participants where session_id=v_sid and lower(btrim(name))=lower(v_name);
 else
 select id into v_pid from public.quiz_live_participants where session_id=v_sid and lower(btrim(name))=lower(v_name);
 end if;
 if v_pid is not null then
 if not private.participant_token_valid(v_pid,p_kind,p_token) then return jsonb_build_object('ok',false,'error','NAME_TAKEN'); end if;
 elsif p_participant_id is not null then
 -- Never silently turn a failed resume into a new identity.
 return jsonb_build_object('ok',false,'error','PARTICIPANT_NAME_MISMATCH');
 else
 if p_kind='survey' then insert into public.participants(session_id,name) values(v_sid,v_name) returning id into v_pid;
 else insert into public.quiz_live_participants(session_id,name) values(v_sid,v_name) returning id into v_pid; end if;
 insert into private.participant_credentials(participant_id,kind,token_hash)
 values(v_pid,p_kind,encode(sha256(convert_to(p_token,'UTF8')),'hex'));
 end if;
 return jsonb_build_object('ok',true,'session_id',v_sid,'participant_id',v_pid,'title',v_title,'join_code',v_code);
end; $$;

create or replace function public.survey_student_state(p_session_id uuid,p_participant_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session jsonb; v_response jsonb;
begin
 if not private.participant_token_valid(p_participant_id,'survey',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 select jsonb_build_object('id',s.id,'title',s.title,'survey_snapshot',s.survey_snapshot,'status',s.status,'current_slide',s.current_slide,'join_code',s.join_code,'updated_at',s.updated_at)
 into v_session from public.sessions s join public.participants p on p.session_id=s.id where s.id=p_session_id and p.id=p_participant_id;
 if v_session is null then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;
 select jsonb_build_object('answer',r.answer,'updated_at',r.updated_at) into v_response from public.responses r
 where r.session_id=p_session_id and r.participant_id=p_participant_id and r.slide_index=(v_session->>'current_slide')::integer;
 return jsonb_build_object('ok',true,'session',v_session,'response',v_response);
end; $$;

create or replace function public.survey_submit_response(p_session_id uuid,p_participant_id uuid,p_token text,p_slide_index integer,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_s public.sessions%rowtype; v_q jsonb; v_t text; v_item jsonb; v_i integer; v_n numeric;
begin
 if not private.participant_token_valid(p_participant_id,'survey',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 select s.* into v_s from public.sessions s join public.participants p on p.session_id=s.id
 where s.id=p_session_id and p.id=p_participant_id for update of s;
 if not found or v_s.status<>'running' or p_slide_index is null or p_slide_index<>v_s.current_slide then return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE'); end if;
 v_q:=v_s.survey_snapshot->p_slide_index; v_t:=v_q->>'type';
 if v_q is null or p_value is null or p_value='null'::jsonb or octet_length(p_value::text)>16000 then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 if v_t='Multiple-Choice' then
 if jsonb_typeof(p_value)<>'string' or not coalesce((v_q->'options') @> jsonb_build_array(p_value),false) then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 elsif v_t in ('Offene Frage','Q&A','Wortwolke') then
 if jsonb_typeof(p_value)<>'string' or length(btrim(p_value#>>'{}'))<1 or length(p_value#>>'{}')>(case when v_t='Wortwolke' then 100 else 500 end) then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 elsif v_t='Pin setzen' then
 if jsonb_typeof(p_value->'x') is distinct from 'number' or jsonb_typeof(p_value->'y') is distinct from 'number' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 if (p_value->>'x')::numeric not between 0 and 100 or (p_value->>'y')::numeric not between 0 and 100 then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 elsif v_t='Ranking' then
 if jsonb_typeof(p_value)<>'array' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 if jsonb_array_length(p_value)<>jsonb_array_length(v_q->'options') or
 (select jsonb_agg(x order by x) from jsonb_array_elements(p_value) x) is distinct from
 (select jsonb_agg(x order by x) from jsonb_array_elements(v_q->'options') x) then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 elsif v_t='Skala' then
 if jsonb_typeof(p_value->'values') is distinct from 'array' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 if jsonb_array_length(p_value->'values')<>jsonb_array_length(v_q->'scaleItems') then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 for v_i in 0..jsonb_array_length(v_q->'scaleItems')-1 loop
 v_item:=v_q->'scaleItems'->v_i;
 if jsonb_typeof(p_value->'values'->v_i->'value') is distinct from 'number' then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 v_n:=(p_value->'values'->v_i->>'value')::numeric;
 if v_n<(v_item->>'min')::numeric or v_n>(v_item->>'max')::numeric then return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 end loop;
 else return jsonb_build_object('ok',false,'error','INVALID_ANSWER'); end if;
 insert into public.responses(session_id,participant_id,slide_index,answer)
 values(p_session_id,p_participant_id,p_slide_index,jsonb_build_object('value',p_value))
 on conflict(session_id,participant_id,slide_index) do nothing;
 return jsonb_build_object('ok',true);
end; $$;

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
    and exists(select 1 from public.quiz_live_participants p where p.id=p_participant_id and p.session_id=s.id) for update of s;
  if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND'); end if;

  update public.quiz_live_participants set last_seen_at=pg_catalog.now()
    where id=p_participant_id and session_id=p_session_id;

  v_index := v_session.current_index;
  v_count := pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions');
  v_qstate := case when v_index>=0 and v_index<v_count then coalesce(v_session.question_states -> v_index,'{}'::jsonb) else '{}'::jsonb end;

  -- Enforce timer expiry on the server even when no student tries to submit after time has run out.
  if v_index>=0 and v_index<v_count
     and not coalesce((v_qstate ->> 'revealed')::boolean,false)
     and nullif(v_qstate ->> 'timer_deadline','') is not null
     and (v_qstate ->> 'timer_deadline')::timestamptz <= pg_catalog.clock_timestamp() then
    v_qstate := pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_qstate,'{locked}','true'::jsonb,true),'{timer_deadline}','null'::jsonb,true);
    v_states := pg_catalog.jsonb_set(v_session.question_states,array[v_index::text],v_qstate,true);
    update public.quiz_live_sessions set question_states=v_states,updated_at=pg_catalog.now() where id=p_session_id;
    v_session.question_states := v_states;
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
create or replace function public.quiz_live_student_state_secure(p_session_id uuid,p_participant_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.participant_token_valid(p_participant_id,'quiz',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 return private.quiz_live_student_state_impl(p_session_id,p_participant_id);
end; $$;

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

  v_state := coalesce(v_session.question_states -> p_question_index,'{}'::jsonb);
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
  if v_type='single' then
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
  values(v_session.id,p_participant_id,p_question_index,p_answer,pg_catalog.now(),null,0,null)
  on conflict(session_id,participant_id,question_index) do update
    set answer=excluded.answer,submitted_at=excluded.submitted_at,is_correct=null,awarded_points=0,evaluated_at=null;
  update public.quiz_live_participants set last_seen_at=pg_catalog.now() where id=p_participant_id;
  return jsonb_build_object('ok',true,'submitted_at',pg_catalog.now());
end;
$function$;
create or replace function public.quiz_live_submit_response_secure(p_session_id uuid,p_participant_id uuid,p_question_index integer,p_answer jsonb,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.participant_token_valid(p_participant_id,'quiz',p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN'); end if;
 return private.quiz_live_submit_response_impl(p_session_id,p_participant_id,p_question_index,p_answer);
end; $$;

-- Remove every legacy ID-only path. RLS is not a substitute for token checks.
revoke all on function public.join_session_by_code(text,text,uuid) from public,anon,authenticated;
revoke all on function public.get_participant_session(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_participant_response(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.quiz_live_join(text,text,uuid) from public,anon,authenticated;
revoke all on function public.quiz_live_student_state(uuid,uuid) from public,anon,authenticated;
revoke all on function public.quiz_live_submit_response(uuid,uuid,integer,jsonb) from public,anon,authenticated;
drop policy if exists responses_anon_insert on public.responses;
revoke insert on public.responses from anon;
revoke all on function private.can_submit_response(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function private.participant_token_valid(uuid,text,text) from public,anon,authenticated;
revoke all on function private.classroom_join_allowed(text) from public,anon,authenticated;
revoke all on function private.quiz_live_student_state_impl(uuid,uuid) from public,anon,authenticated;
revoke all on function private.quiz_live_submit_response_impl(uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.classroom_join(text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.survey_student_state(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.survey_submit_response(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.quiz_live_student_state_secure(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.quiz_live_submit_response_secure(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.classroom_join(text,text,text,text,uuid) to anon,authenticated;
grant execute on function public.survey_student_state(uuid,uuid,text) to anon,authenticated;
grant execute on function public.survey_submit_response(uuid,uuid,text,integer,jsonb) to anon,authenticated;
grant execute on function public.quiz_live_student_state_secure(uuid,uuid,text) to anon,authenticated;
grant execute on function public.quiz_live_submit_response_secure(uuid,uuid,integer,jsonb,text) to anon,authenticated;

-- Immutable media: the frontend cannot remove or overwrite historical versions.
drop policy if exists survey_media_authenticated_delete on storage.objects;
drop policy if exists survey_media_preserve_versions on storage.objects;
create policy survey_media_preserve_versions on storage.objects as restrictive for delete to authenticated using(bucket_id<>'survey-media');
drop policy if exists survey_media_no_overwrite on storage.objects;
create policy survey_media_no_overwrite on storage.objects as restrictive for update to authenticated using(bucket_id<>'survey-media') with check(bucket_id<>'survey-media');
notify pgrst,'reload schema';
