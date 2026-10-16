-- Quiz Studio Live Quiz schema and RPCs.
-- Apply base schema.sql first, then this file to create Live Quiz support.
-- All participant-facing reads/writes go through narrow RPCs. Answer keys are
-- removed from student payloads until the teacher reveals the current question.
--
-- This file mirrors the Live Quiz schema currently deployed in Supabase.

create schema if not exists private;

create table if not exists public.quiz_live_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  quiz_title text not null,
  quiz_snapshot jsonb not null,
  status text not null default 'lobby' check (status in ('lobby','running','ended')),
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{5}$'),
  current_index integer not null default -1,
  question_states jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists quiz_live_sessions_owner_created_idx
  on public.quiz_live_sessions(owner_id, created_at desc);

create table if not exists public.quiz_live_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quiz_live_sessions(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists quiz_live_participants_session_idx
  on public.quiz_live_participants(session_id);
create unique index if not exists quiz_live_participants_normalized_name_uidx
  on public.quiz_live_participants(session_id, lower(btrim(name)));

create table if not exists public.quiz_live_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quiz_live_sessions(id) on delete cascade,
  participant_id uuid not null references public.quiz_live_participants(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  answer jsonb not null,
  submitted_at timestamptz not null default now(),
  is_correct boolean,
  awarded_points numeric(10,2) not null default 0,
  evaluated_at timestamptz,
  unique(session_id, participant_id, question_index)
);
create index if not exists quiz_live_responses_session_question_idx
  on public.quiz_live_responses(session_id, question_index);
create index if not exists quiz_live_responses_participant_idx
  on public.quiz_live_responses(participant_id);

create table if not exists private.quiz_live_join_rate_limits (
  ip_hash text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);
alter table private.quiz_live_join_rate_limits enable row level security;
revoke all on table private.quiz_live_join_rate_limits from public, anon, authenticated;

alter table public.quiz_live_sessions enable row level security;
alter table public.quiz_live_participants enable row level security;
alter table public.quiz_live_responses enable row level security;

drop policy if exists quiz_live_sessions_owner_select on public.quiz_live_sessions;
create policy quiz_live_sessions_owner_select on public.quiz_live_sessions
for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists quiz_live_sessions_owner_delete on public.quiz_live_sessions;
create policy quiz_live_sessions_owner_delete on public.quiz_live_sessions
for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists quiz_live_participants_owner_select on public.quiz_live_participants;
create policy quiz_live_participants_owner_select on public.quiz_live_participants
for select to authenticated using (
  exists(select 1 from public.quiz_live_sessions s
         where s.id = session_id and s.owner_id = (select auth.uid()))
);
drop policy if exists quiz_live_responses_owner_select on public.quiz_live_responses;
create policy quiz_live_responses_owner_select on public.quiz_live_responses
for select to authenticated using (
  exists(select 1 from public.quiz_live_sessions s
         where s.id = session_id and s.owner_id = (select auth.uid()))
);

grant select, delete on public.quiz_live_sessions to authenticated;
grant select on public.quiz_live_participants, public.quiz_live_responses to authenticated;
revoke all on public.quiz_live_sessions, public.quiz_live_participants, public.quiz_live_responses from anon;

CREATE OR REPLACE FUNCTION private.quiz_live_is_correct(p_question jsonb, p_answer jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_type text := p_question ->> 'type';
  v_text text;
  v_expected text[];
  v_actual text[];
begin
  if p_answer is null then return false; end if;

  if v_type = 'single' then
    if pg_catalog.jsonb_typeof(p_answer) <> 'string' then return false; end if;
    return exists(
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(p_question -> 'options','[]'::jsonb)) o(value)
      where o.value ->> 'id' = p_answer #>> '{}'
        and coalesce((o.value ->> 'correct')::boolean,false)
    );
  elsif v_type = 'multiple' then
    if pg_catalog.jsonb_typeof(p_answer) <> 'array' then return false; end if;
    select coalesce(pg_catalog.array_agg(o.value ->> 'id' order by o.value ->> 'id'), array[]::text[])
      into v_expected
    from pg_catalog.jsonb_array_elements(coalesce(p_question -> 'options','[]'::jsonb)) o(value)
    where coalesce((o.value ->> 'correct')::boolean,false);
    select coalesce(pg_catalog.array_agg(x.value order by x.value), array[]::text[])
      into v_actual
    from pg_catalog.jsonb_array_elements_text(p_answer) x(value);
    return coalesce(pg_catalog.cardinality(v_expected),0) > 0 and v_expected = v_actual;
  elsif v_type = 'truefalse' then
    return pg_catalog.jsonb_typeof(p_answer) = 'boolean'
      and p_answer = coalesce(p_question -> 'correct','null'::jsonb);
  elsif v_type = 'ranking' then
    if pg_catalog.jsonb_typeof(p_answer) <> 'array' then return false; end if;
    select coalesce(pg_catalog.array_agg(i.value ->> 'id' order by i.ordinality), array[]::text[])
      into v_expected
    from pg_catalog.jsonb_array_elements(coalesce(p_question -> 'items','[]'::jsonb))
      with ordinality i(value, ordinality);
    select coalesce(pg_catalog.array_agg(x.value order by x.ordinality), array[]::text[])
      into v_actual
    from pg_catalog.jsonb_array_elements_text(p_answer)
      with ordinality x(value, ordinality);
    return pg_catalog.cardinality(v_expected) > 0 and v_expected = v_actual;
  elsif v_type = 'shortanswer' then
    if pg_catalog.jsonb_typeof(p_answer) <> 'string' then return false; end if;
    v_text := pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_answer #>> '{}'), '[[:space:]]+', '', 'g'));
    return exists(
      select 1
      from pg_catalog.jsonb_array_elements_text(coalesce(p_question -> 'answers','[]'::jsonb)) a(value)
      where pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(a.value), '[[:space:]]+', '', 'g')) = v_text
        and v_text <> ''
    );
  end if;
  return false;
end;
$function$;


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
    pg_catalog.jsonb_build_object('locked',false,'revealed',false,'timer_seconds',null,'timer_deadline',null)
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

CREATE OR REPLACE FUNCTION public.quiz_live_join(p_join_code text, p_name text, p_participant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.quiz_live_sessions%rowtype;
  v_name text := pg_catalog.left(pg_catalog.btrim(coalesce(p_name,'')),40);
  v_participant uuid;
  v_existing_name text;
  v_headers jsonb;
  v_ip text;
  v_ip_hash text;
  v_attempts integer;
begin
  if pg_catalog.upper(pg_catalog.btrim(coalesce(p_join_code,''))) !~ '^[A-Z0-9]{5}$'
     or pg_catalog.char_length(v_name)<1 then
    return jsonb_build_object('ok',false,'error','INVALID_INPUT');
  end if;
  select * into v_session from public.quiz_live_sessions s
  where s.join_code=pg_catalog.upper(pg_catalog.btrim(p_join_code))
    and s.status in ('lobby','running')
  limit 1;

  if not found then
    v_headers := coalesce(nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
    v_ip := coalesce(
      nullif(v_headers->>'cf-connecting-ip',''),
      nullif(v_headers->>'x-real-ip',''),
      nullif(pg_catalog.split_part(coalesce(v_headers->>'x-forwarded-for',''),',',1),''),
      'unknown'
    );
    v_ip_hash := pg_catalog.md5(v_ip);
    insert into private.quiz_live_join_rate_limits as r(ip_hash,window_start,attempts)
    values(v_ip_hash,pg_catalog.now(),1)
    on conflict(ip_hash) do update
      set window_start=case when r.window_start<pg_catalog.now()-interval '10 minutes' then pg_catalog.now() else r.window_start end,
          attempts=case when r.window_start<pg_catalog.now()-interval '10 minutes' then 1 else r.attempts+1 end
    returning attempts into v_attempts;
    if v_attempts>50 then return jsonb_build_object('ok',false,'error','RATE_LIMITED'); end if;
    return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND');
  end if;

  if p_participant_id is not null then
    select p.id,p.name into v_participant,v_existing_name
    from public.quiz_live_participants p
    where p.id=p_participant_id and p.session_id=v_session.id;
    if found then
      if pg_catalog.lower(pg_catalog.btrim(v_existing_name)) <> pg_catalog.lower(v_name) then
        return jsonb_build_object('ok',false,'error','NAME_MISMATCH');
      end if;
      update public.quiz_live_participants set last_seen_at=pg_catalog.now() where id=v_participant;
      return jsonb_build_object('ok',true,'session_id',v_session.id,'title',v_session.quiz_title,
        'join_code',v_session.join_code,'participant_id',v_participant,'status',v_session.status,
        'current_index',v_session.current_index);
    end if;
  end if;

  if exists(select 1 from public.quiz_live_participants p where p.session_id=v_session.id
            and pg_catalog.lower(pg_catalog.btrim(p.name))=pg_catalog.lower(v_name)) then
    return jsonb_build_object('ok',false,'error','NAME_TAKEN');
  end if;
  insert into public.quiz_live_participants(session_id,name) values(v_session.id,v_name)
    returning id into v_participant;
  return jsonb_build_object('ok',true,'session_id',v_session.id,'title',v_session.quiz_title,
    'join_code',v_session.join_code,'participant_id',v_participant,'status',v_session.status,
    'current_index',v_session.current_index);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','NAME_TAKEN');
end;
$function$;


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

CREATE OR REPLACE FUNCTION public.quiz_live_submit_response(p_session_id uuid, p_participant_id uuid, p_question_index integer, p_answer jsonb)
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

CREATE OR REPLACE FUNCTION public.quiz_live_start(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session public.quiz_live_sessions%rowtype;
begin
  select * into v_session from public.quiz_live_sessions where id=p_session_id for update;
  if not found or v_session.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
  if v_session.status<>'lobby' then return jsonb_build_object('ok',false,'error','INVALID_STATUS'); end if;
  update public.quiz_live_sessions set status='running',current_index=0,updated_at=pg_catalog.now() where id=p_session_id;
  return jsonb_build_object('ok',true,'current_index',0);
end;
$function$;


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
    update public.quiz_live_sessions
      set status='running',current_index=p_target_index,ended_at=null,updated_at=pg_catalog.now()
      where id=p_session_id;
  end if;
  return jsonb_build_object('ok',true,'current_index',p_target_index);
end;
$function$;


CREATE OR REPLACE FUNCTION public.quiz_live_start_timer(p_session_id uuid, p_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session public.quiz_live_sessions%rowtype; v_state jsonb; v_states jsonb; v_deadline timestamptz;
begin
  if p_seconds<5 or p_seconds>3600 then return jsonb_build_object('ok',false,'error','INVALID_TIMER'); end if;
  select * into v_session from public.quiz_live_sessions where id=p_session_id for update;
  if not found or v_session.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
  if v_session.status<>'running' or v_session.current_index<0 or v_session.current_index>=pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions') then
    return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE');
  end if;
  v_state := coalesce(v_session.question_states -> v_session.current_index,'{}'::jsonb);
  if coalesce((v_state ->> 'locked')::boolean,false) or coalesce((v_state ->> 'revealed')::boolean,false) then
    return jsonb_build_object('ok',false,'error','QUESTION_LOCKED');
  end if;
  v_deadline := pg_catalog.now() + pg_catalog.make_interval(secs=>p_seconds);
  v_state := pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_state,'{timer_seconds}',pg_catalog.to_jsonb(p_seconds),true),'{timer_deadline}',pg_catalog.to_jsonb(v_deadline),true);
  v_states := pg_catalog.jsonb_set(v_session.question_states,array[v_session.current_index::text],v_state,true);
  update public.quiz_live_sessions set question_states=v_states,updated_at=pg_catalog.now() where id=p_session_id;
  return jsonb_build_object('ok',true,'timer_deadline',v_deadline,'timer_seconds',p_seconds);
end;
$function$;


CREATE OR REPLACE FUNCTION public.quiz_live_lock_question(p_session_id uuid, p_question_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_session public.quiz_live_sessions%rowtype; v_state jsonb; v_states jsonb;
begin
  select * into v_session from public.quiz_live_sessions where id=p_session_id for update;
  if not found or v_session.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER'); end if;
  if p_question_index<0 or p_question_index>=pg_catalog.jsonb_array_length(v_session.quiz_snapshot -> 'questions') then
    return jsonb_build_object('ok',false,'error','INVALID_INDEX');
  end if;
  if v_session.status<>'running' or p_question_index<>v_session.current_index then
    return jsonb_build_object('ok',false,'error','QUESTION_NOT_ACTIVE');
  end if;
  v_state := coalesce(v_session.question_states -> p_question_index,'{}'::jsonb);
  v_state := pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_state,'{locked}','true'::jsonb,true),'{timer_deadline}','null'::jsonb,true);
  v_states := pg_catalog.jsonb_set(v_session.question_states,array[p_question_index::text],v_state,true);
  update public.quiz_live_sessions set question_states=v_states,updated_at=pg_catalog.now() where id=p_session_id;
  return jsonb_build_object('ok',true);
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
    v_correct := private.quiz_live_is_correct(v_question,v_row.answer);
    update public.quiz_live_responses
      set is_correct=v_correct,awarded_points=case when v_correct then v_points else 0 end,evaluated_at=pg_catalog.now()
      where id=v_row.id;
  end loop;
  return jsonb_build_object('ok',true,'already_revealed',false);
end;
$function$;


-- Restrict RPC execution to the intended classroom roles.
revoke all on function public.quiz_live_create(jsonb) from public, anon, authenticated;
revoke all on function public.quiz_live_join(text,text,uuid) from public, anon, authenticated;
revoke all on function public.quiz_live_student_state(uuid,uuid) from public, anon, authenticated;
revoke all on function public.quiz_live_submit_response(uuid,uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.quiz_live_start(uuid) from public, anon, authenticated;
revoke all on function public.quiz_live_navigate(uuid,integer) from public, anon, authenticated;
revoke all on function public.quiz_live_start_timer(uuid,integer) from public, anon, authenticated;
revoke all on function public.quiz_live_lock_question(uuid,integer) from public, anon, authenticated;
revoke all on function public.quiz_live_reveal_question(uuid,integer) from public, anon, authenticated;
revoke all on function private.quiz_live_is_correct(jsonb,jsonb) from public, anon, authenticated;

grant execute on function public.quiz_live_create(jsonb) to authenticated;
-- Token-protected student access is installed by security_hardening.sql.
-- Token-protected student access is installed by security_hardening.sql.
-- Token-protected student access is installed by security_hardening.sql.
grant execute on function public.quiz_live_start(uuid) to authenticated;
grant execute on function public.quiz_live_navigate(uuid,integer) to authenticated;
grant execute on function public.quiz_live_start_timer(uuid,integer) to authenticated;
grant execute on function public.quiz_live_lock_question(uuid,integer) to authenticated;
grant execute on function public.quiz_live_reveal_question(uuid,integer) to authenticated;


-- Required final installation step: apply security_hardening.sql.
