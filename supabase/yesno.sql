-- Apply after bluff.sql, bluff_library.sql, bluff_flow.sql and bluff_reveal.sql.
-- Private game data is exposed only through checked RPCs; signals contain no answers.
create schema if not exists private;
create table if not exists private.yesno_questions (
 id bigint generated always as identity primary key,
 owner_id uuid references auth.users(id) on delete cascade,
 seed_key text unique,
 question text not null check(length(btrim(question)) between 1 and 500),
 pack text not null check(length(btrim(pack)) between 1 and 60),
 updated_at timestamptz not null default now()
);
create table if not exists private.yesno_hidden_questions (
 owner_id uuid references auth.users(id) on delete cascade,
 question_id bigint references private.yesno_questions(id) on delete cascade,
 primary key(owner_id,question_id)
);
create table if not exists private.yesno_games (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 120),
 questions jsonb not null,
 updated_at timestamptz not null default now()
);
create table if not exists private.yesno_sessions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 join_code text not null unique,
 title text not null,
 questions jsonb not null,
 seconds integer not null check(seconds between 5 and 300),
 exact_points integer not null check(exact_points between 0 and 100),
 near_points integer not null check(near_points between 0 and 100),
 phase text not null default 'lobby' check(phase in ('lobby','question','result','finished','ended')),
 round_index integer not null default 0,
 player_count integer not null default 0,
 deadline timestamptz,
 revision bigint not null default 0,
 created_at timestamptz not null default now(),
 unique(owner_id,request_id)
);
create index if not exists yesno_sessions_owner_idx on private.yesno_sessions(owner_id,created_at desc);
create index if not exists yesno_questions_owner_idx on private.yesno_questions(owner_id);
create index if not exists yesno_games_owner_idx on private.yesno_games(owner_id,updated_at desc);
create table if not exists private.yesno_players (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references private.yesno_sessions(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 40),
 token_hash text not null,
 ready boolean not null default false,
 unique(session_id,token_hash),
 unique(session_id,id)
);
create unique index if not exists yesno_player_name_idx on private.yesno_players(session_id,lower(btrim(name)));
create table if not exists private.yesno_answers (
 session_id uuid not null,
 round_index integer not null,
 player_id uuid not null,
 answer boolean not null,
 estimate integer not null check(estimate>=0),
 points integer,
 submitted_at timestamptz not null default clock_timestamp(),
 primary key(session_id,round_index,player_id),
 foreign key(session_id,player_id) references private.yesno_players(session_id,id) on delete cascade
);
create table if not exists public.yesno_live_signals (
 session_id uuid primary key references private.yesno_sessions(id) on delete cascade,
 revision bigint not null default 0
);
alter table public.yesno_live_signals enable row level security;
drop policy if exists yesno_signal_read on public.yesno_live_signals;
create policy yesno_signal_read on public.yesno_live_signals for select to anon,authenticated using(true);
revoke all on public.yesno_live_signals from public,anon,authenticated;
grant select on public.yesno_live_signals to anon,authenticated;
do $$declare t text;begin
 foreach t in array array['yesno_questions','yesno_hidden_questions','yesno_games','yesno_sessions','yesno_players','yesno_answers'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='yesno_live_signals') then
  alter publication supabase_realtime add table public.yesno_live_signals;
 end if;
end;$$;

insert into private.yesno_questions(seed_key,question,pack) values
 ('alltag1','Hast du schon einmal deinen Schlüssel vergessen?','Alltag'),
 ('alltag2','Hast du schon einmal etwas gesucht, das du in der Hand hattest?','Alltag'),
 ('alltag3','Bist du heute zu Fuß zur Schule gekommen?','Alltag'),
 ('alltag4','Hast du schon einmal im Regen getanzt?','Alltag'),
 ('alltag5','Hast du schon einmal einen Kuchen gebacken?','Alltag'),
 ('freizeit1','Kannst du ein Musikinstrument spielen?','Freizeit'),
 ('freizeit2','Hast du schon einmal im Zelt übernachtet?','Freizeit'),
 ('freizeit3','Liest du gerade ein Buch in deiner Freizeit?','Freizeit'),
 ('freizeit4','Hast du schon einmal einen Sonnenaufgang beobachtet?','Freizeit'),
 ('freizeit5','Spielst du gerne Gesellschaftsspiele?','Freizeit'),
 ('schule1','Hast du schon einmal eine freiwillige Zusatzaufgabe gelöst?','Schule'),
 ('schule2','Lernst du lieber zusammen mit anderen?','Schule'),
 ('schule3','Hast du schon einmal jemandem bei einer Matheaufgabe geholfen?','Schule'),
 ('schule4','Hast du schon einmal ein Experiment zu Hause ausprobiert?','Schule'),
 ('schule5','Hast du schon einmal ein Referat mit einem Modell gehalten?','Schule')
on conflict(seed_key) do nothing;

create or replace function private.yesno_available_questions()
returns setof private.yesno_questions language sql stable security definer set search_path='' as $$
 select q.* from private.yesno_questions q where (q.owner_id=auth.uid() or q.owner_id is null)
 and not exists(select 1 from private.yesno_hidden_questions h where h.owner_id=auth.uid() and h.question_id=q.id);
$$;
create or replace function public.yesno_question_list()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 return jsonb_build_object('ok',true,'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'pack',pack) order by pack,id),'[]') from private.yesno_available_questions()));
end;$$;
create or replace function public.yesno_question_save(p_id bigint,p_question text,p_pack text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.yesno_questions%rowtype; v_id bigint;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_question is null or length(btrim(p_question)) not between 1 and 500 or p_pack is null or length(btrim(p_pack)) not between 1 and 60 then return jsonb_build_object('ok',false,'error','INVALID_QUESTION');end if;
 if p_id is not null then
  select * into q from private.yesno_available_questions() where id=p_id;
  if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 end if;
 if p_id is null or q.owner_id is null then
  insert into private.yesno_questions(owner_id,question,pack) values(auth.uid(),btrim(p_question),btrim(p_pack)) returning id into v_id;
  if p_id is not null then insert into private.yesno_hidden_questions values(auth.uid(),p_id) on conflict do nothing;end if;
 else
  update private.yesno_questions set question=btrim(p_question),pack=btrim(p_pack),updated_at=now() where id=p_id and owner_id=auth.uid() returning id into v_id;
 end if;
 return jsonb_build_object('ok',true,'id',v_id);
end;$$;
create or replace function public.yesno_question_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.yesno_questions%rowtype;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 select * into q from private.yesno_available_questions() where id=p_id;
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 if q.owner_id is null then insert into private.yesno_hidden_questions values(auth.uid(),p_id) on conflict do nothing;
 else delete from private.yesno_questions where id=p_id and owner_id=auth.uid();end if;
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.yesno_game_list()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 return jsonb_build_object('ok',true,'games',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'questions',questions) order by updated_at desc,id),'[]') from private.yesno_games where owner_id=auth.uid()),
 'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'join_code',join_code,'phase',phase) order by created_at desc),'[]') from (select * from private.yesno_sessions where owner_id=auth.uid() and phase in ('lobby','question','result') order by created_at desc limit 20) s));
end;$$;
create or replace function public.yesno_game_save(p_id uuid,p_name text,p_question_ids bigint[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_questions jsonb:='[]';chosen jsonb;v_id uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 then return jsonb_build_object('ok',false,'error','INVALID_NAME');end if;
 if p_question_ids is null or cardinality(p_question_ids) not between 1 and 50 or cardinality(p_question_ids)<>(select count(distinct x) from unnest(p_question_ids) x) then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 if p_id is not null then
  select questions into old_questions from private.yesno_games where id=p_id and owner_id=auth.uid() for update;
  if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 end if;
 select jsonb_agg(coalesce((select jsonb_build_object('id',id,'question',question,'pack',pack) from private.yesno_available_questions() where id=x.id),
 (select j from jsonb_array_elements(old_questions) j where (j->>'id')::bigint=x.id)) order by x.ord) into chosen from unnest(p_question_ids) with ordinality x(id,ord);
 if exists(select 1 from jsonb_array_elements(chosen) j where j='null'::jsonb) then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 if p_id is null then insert into private.yesno_games(owner_id,name,questions) values(auth.uid(),btrim(p_name),chosen) returning id into v_id;
 else update private.yesno_games set name=btrim(p_name),questions=chosen,updated_at=now() where id=p_id and owner_id=auth.uid() returning id into v_id;end if;
 return jsonb_build_object('ok',true,'id',v_id);
end;$$;
create or replace function public.yesno_game_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 delete from private.yesno_games where id=p_id and owner_id=auth.uid();
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 return jsonb_build_object('ok',true);
end;$$;

create or replace function private.yesno_touch(p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rev bigint;
begin
 update private.yesno_sessions set revision=revision+1 where id=p_session returning revision into rev;
 insert into public.yesno_live_signals(session_id,revision) values(p_session,rev) on conflict(session_id) do update set revision=excluded.revision;
end;$$;
create or replace function private.yesno_token_valid(p_session uuid,p_player uuid,p_token text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_token~'^[a-f0-9]{64}$',false) and exists(select 1 from private.yesno_players where id=p_player and session_id=p_session and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex'));
$$;
create or replace function public.yesno_create(p_request_id uuid,p_game_id uuid,p_rounds integer,p_seconds integer,p_exact integer,p_near integer,p_packs text[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pool jsonb;chosen jsonb;s private.yesno_sessions%rowtype;v_title text:='Zufälliges Ja/Nein-Spiel';code text;tries integer;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_request_id is null or p_rounds is null or p_rounds not between 1 and 50 or p_seconds is null or p_seconds not between 5 and 300 or p_exact is null or p_exact not between 0 and 100 or p_near is null or p_near not between 0 and 100 or p_near>p_exact then return jsonb_build_object('ok',false,'error','INVALID_SETTINGS');end if;
 -- Serializes retries of the same lobby creation without serializing other users.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into s from private.yesno_sessions where owner_id=auth.uid() and request_id=p_request_id;
 if found then return jsonb_build_object('ok',true,'session_id',s.id,'join_code',s.join_code);end if;
 if p_game_id is not null then
  select questions,name into pool,v_title from private.yesno_games where id=p_game_id and owner_id=auth.uid();
  if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 else select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'pack',pack)),'[]') into pool from private.yesno_available_questions();end if;
 select coalesce(jsonb_agg(j),'[]') into pool from jsonb_array_elements(pool) j where p_packs is null or j->>'pack'=any(p_packs);
 if jsonb_array_length(pool)<p_rounds then return jsonb_build_object('ok',false,'error','NOT_ENOUGH_QUESTIONS');end if;
 select jsonb_agg(j) into chosen from (select j from jsonb_array_elements(pool) j order by random() limit p_rounds) q;
 for tries in 1..20 loop
  code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
  begin
   insert into private.yesno_sessions(owner_id,request_id,join_code,title,questions,seconds,exact_points,near_points) values(auth.uid(),p_request_id,code,v_title,chosen,p_seconds,p_exact,p_near) returning * into s;
   exit;
  exception when unique_violation then if tries=20 then raise;end if;end;
 end loop;
 perform private.yesno_touch(s.id);
 return jsonb_build_object('ok',true,'session_id',s.id,'join_code',s.join_code);
end;$$;
create or replace function public.yesno_join(p_code text,p_name text,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;p private.yesno_players%rowtype;v_name text:=btrim(p_name);v_hash text;
begin
 if not private.classroom_join_allowed('yesno') then return jsonb_build_object('ok',false,'error','JOIN_RATE_LIMITED');end if;
 if p_token is null or p_token!~'^[a-f0-9]{64}$' or v_name is null or length(v_name) not between 1 and 40 or p_code is null or upper(btrim(p_code))!~'^[A-Z0-9]{5}$' then return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT');end if;
 select * into s from private.yesno_sessions where join_code=upper(btrim(p_code)) for update;
 if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND');end if;
 v_hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 select * into p from private.yesno_players where session_id=s.id and token_hash=v_hash;
 if found then return jsonb_build_object('ok',true,'session_id',s.id,'player_id',p.id,'name',p.name,'join_code',s.join_code);end if;
 if s.phase<>'lobby' then return jsonb_build_object('ok',false,'error','GAME_ALREADY_STARTED');end if;
 if exists(select 1 from private.yesno_players where session_id=s.id and lower(btrim(name))=lower(v_name)) then return jsonb_build_object('ok',false,'error','NAME_TAKEN');end if;
 if (select count(*) from private.yesno_players where session_id=s.id)>=100 then return jsonb_build_object('ok',false,'error','ROOM_FULL');end if;
 insert into private.yesno_players(session_id,name,token_hash) values(s.id,v_name,v_hash) returning * into p;
 perform private.yesno_touch(s.id);
 return jsonb_build_object('ok',true,'session_id',s.id,'player_id',p.id,'name',p.name,'join_code',s.join_code);
end;$$;
create or replace function public.yesno_ready(p_session_id uuid,p_player_id uuid,p_token text,p_ready boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare phase text;
begin
 if not private.yesno_token_valid(p_session_id,p_player_id,p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN');end if;
 select s.phase into phase from private.yesno_sessions s where id=p_session_id for update;
 if phase<>'lobby' or p_ready is null then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 update private.yesno_players set ready=p_ready where id=p_player_id and ready is distinct from p_ready;
 if found then perform private.yesno_touch(p_session_id);end if;
 return jsonb_build_object('ok',true);
end;$$;

-- Caller has already checked the host or participant credentials. The row lock
-- makes timeout, last submission and concurrent state requests settle once.
create or replace function private.yesno_settle(p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;v_count integer;v_yes integer;
begin
 select * into s from private.yesno_sessions where id=p_session;
 if s.phase<>'question' then return;end if;
 if s.deadline>clock_timestamp() and (select count(*) from private.yesno_answers where session_id=s.id and round_index=s.round_index)<s.player_count then return;end if;
 select * into s from private.yesno_sessions where id=p_session for update;
 if s.phase<>'question' then return;end if;
 select count(*),count(*) filter(where answer) into v_count,v_yes from private.yesno_answers where session_id=s.id and round_index=s.round_index;
 if s.deadline>clock_timestamp() and v_count<s.player_count then return;end if;
 update private.yesno_answers set points=case when estimate=v_yes then s.exact_points when abs(estimate-v_yes)=1 then s.near_points else 0 end where session_id=s.id and round_index=s.round_index;
 update private.yesno_sessions set phase=case when round_index+1=jsonb_array_length(questions) then 'finished' else 'result' end,deadline=null where id=s.id;
 perform private.yesno_touch(s.id);
end;$$;
create or replace function private.yesno_state(p_session uuid,p_player uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;players jsonb;results jsonb;own jsonb;v_yes integer;v_no integer;
begin
 perform private.yesno_settle(p_session);
 select * into s from private.yesno_sessions where id=p_session;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'ready',p.ready,'submitted',exists(select 1 from private.yesno_answers a where a.session_id=s.id and a.round_index=s.round_index and a.player_id=p.id),'score',coalesce(t.score,0)) order by coalesce(t.score,0) desc,lower(p.name),p.id),'[]') into players
 from private.yesno_players p left join lateral(select sum(points) score from private.yesno_answers a where a.session_id=s.id and a.player_id=p.id) t on true where p.session_id=s.id;
 select jsonb_build_object('answer',answer,'estimate',estimate) into own from private.yesno_answers where session_id=s.id and round_index=s.round_index and player_id=p_player;
 if s.phase in ('result','finished') then
  select count(*) filter(where answer),count(*) filter(where not answer) into v_yes,v_no from private.yesno_answers where session_id=s.id and round_index=s.round_index;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'estimate',a.estimate,'points',coalesce(a.points,0),'exact',coalesce(a.estimate=v_yes,false)) order by coalesce(a.points,0) desc,lower(p.name),p.id),'[]') into results from private.yesno_players p left join private.yesno_answers a on a.session_id=p.session_id and a.player_id=p.id and a.round_index=s.round_index where p.session_id=s.id;
 end if;
 return jsonb_build_object('ok',true,'session_id',s.id,'title',s.title,'join_code',s.join_code,'phase',s.phase,'round_index',s.round_index,'round_count',jsonb_array_length(s.questions),'seconds',s.seconds,'exact_points',s.exact_points,'near_points',s.near_points,'deadline',s.deadline,'server_now',clock_timestamp(),'revision',s.revision,
 'question',case when s.phase='lobby' then null else s.questions->s.round_index->>'question' end,'player_count',case when s.phase='lobby' then jsonb_array_length(players) else s.player_count end,'players',players,'own_answer',own,'yes_count',v_yes,'no_count',v_no,'results',coalesce(results,'[]'));
end;$$;
create or replace function public.yesno_host_state(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from private.yesno_sessions where id=p_session_id and owner_id=auth.uid()) then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 return private.yesno_state(p_session_id,null);
end;$$;
create or replace function public.yesno_player_state(p_session_id uuid,p_player_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.yesno_token_valid(p_session_id,p_player_id,p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN');end if;
 return private.yesno_state(p_session_id,p_player_id);
end;$$;
create or replace function public.yesno_submit(p_session_id uuid,p_player_id uuid,p_token text,p_round integer,p_answer boolean,p_estimate integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;existing private.yesno_answers%rowtype;
begin
 if not private.yesno_token_valid(p_session_id,p_player_id,p_token) then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN');end if;
 select * into s from private.yesno_sessions where id=p_session_id for update;
 if p_round is null or p_round<>s.round_index then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 select * into existing from private.yesno_answers where session_id=s.id and round_index=p_round and player_id=p_player_id;
 if found then
  if existing.answer is not distinct from p_answer and existing.estimate is not distinct from p_estimate then return jsonb_build_object('ok',true);end if;
  return jsonb_build_object('ok',false,'error','ALREADY_SUBMITTED');
 end if;
 if s.phase<>'question' then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 if s.deadline<=clock_timestamp() then perform private.yesno_settle(s.id);return jsonb_build_object('ok',false,'error','TIME_EXPIRED');end if;
 if p_answer is null or p_estimate is null or p_estimate not between 0 and s.player_count then return jsonb_build_object('ok',false,'error','INVALID_ANSWER');end if;
 insert into private.yesno_answers(session_id,round_index,player_id,answer,estimate) values(s.id,p_round,p_player_id,p_answer,p_estimate);
 perform private.yesno_touch(s.id);perform private.yesno_settle(s.id);
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.yesno_host_action(p_session_id uuid,p_round integer,p_phase text,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;v_count integer;
begin
 select * into s from private.yesno_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 if p_action='end' then
  if s.phase not in ('ended','finished') then update private.yesno_sessions set phase='ended',deadline=null where id=s.id;perform private.yesno_touch(s.id);end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_round is null or p_phase is null or p_round<>s.round_index or p_phase<>s.phase then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 if p_action='start' and s.phase='lobby' then
  select count(*) into v_count from private.yesno_players where session_id=s.id;
  if v_count<2 then return jsonb_build_object('ok',false,'error','NEED_TWO_PLAYERS');end if;
  if exists(select 1 from private.yesno_players where session_id=s.id and not ready) then return jsonb_build_object('ok',false,'error','NOT_ALL_READY');end if;
  update private.yesno_sessions set phase='question',player_count=v_count,deadline=clock_timestamp()+make_interval(secs=>seconds) where id=s.id;
 elsif p_action='next' and s.phase='result' then
  update private.yesno_sessions set phase='question',round_index=round_index+1,deadline=clock_timestamp()+make_interval(secs=>seconds) where id=s.id;
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION');end if;
 perform private.yesno_touch(s.id);return jsonb_build_object('ok',true);
end;$$;

-- Revoke PostgreSQL's default PUBLIC execute before exposing the narrow APIs.
do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'yesno\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 end loop;
end;$$;
grant execute on function public.yesno_question_list(),public.yesno_question_save(bigint,text,text),public.yesno_question_delete(bigint),public.yesno_game_list(),public.yesno_game_save(uuid,text,bigint[]),public.yesno_game_delete(uuid),public.yesno_create(uuid,uuid,integer,integer,integer,integer,text[]),public.yesno_host_state(uuid),public.yesno_host_action(uuid,integer,text,text) to authenticated;
grant execute on function public.yesno_join(text,text,text),public.yesno_ready(uuid,uuid,text,boolean),public.yesno_player_state(uuid,uuid,text),public.yesno_submit(uuid,uuid,text,integer,boolean,integer) to anon,authenticated;

create or replace function public.classroom_resolve_code(p_join_code text,p_kind_hint text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=upper(btrim(coalesce(p_join_code,''))); kinds jsonb:='[]';
begin
 if not private.classroom_join_allowed('entry') then return jsonb_build_object('ok',false,'error','JOIN_RATE_LIMITED');end if;
 if code!~'^[A-Z0-9]{5}$' then return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT');end if;
 if (p_kind_hint is null or p_kind_hint='survey') and exists(select 1 from public.sessions where join_code=code and status in ('lobby','running')) then kinds:=kinds||'"survey"'::jsonb;end if;
 if (p_kind_hint is null or p_kind_hint='quiz') and exists(select 1 from public.quiz_live_sessions where join_code=code and status in ('lobby','running')) then kinds:=kinds||'"quiz"'::jsonb;end if;
 if (p_kind_hint is null or p_kind_hint='bluff') and exists(select 1 from private.bluff_sessions where join_code=code and phase<>'ended') then kinds:=kinds||'"bluff"'::jsonb;end if;
 if (p_kind_hint is null or p_kind_hint='yesno') and exists(select 1 from private.yesno_sessions where join_code=code and phase='lobby') then kinds:=kinds||'"yesno"'::jsonb;end if;
 if jsonb_array_length(kinds)=0 then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND');end if;
 return jsonb_build_object('ok',true,'kinds',kinds);
end;$$;
revoke all on function public.classroom_resolve_code(text,text) from public,anon,authenticated;
grant execute on function public.classroom_resolve_code(text,text) to anon,authenticated;
notify pgrst,'reload schema';
