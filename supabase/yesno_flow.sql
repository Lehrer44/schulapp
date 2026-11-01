-- Apply after yesno_settings.sql. Evaluation and answer publication are host actions.
-- The old reveal_answers creation setting is retained for API compatibility only.
alter table private.yesno_sessions add column if not exists answers_revealed_round integer not null default -1;

-- Kept for existing submit RPCs: submissions and reads no longer score or advance.
create or replace function private.yesno_settle(p_session uuid)
returns void language plpgsql security definer set search_path='' as $$begin return;end;$$;

create or replace function private.yesno_state(p_session uuid,p_player uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;players jsonb;results jsonb;own jsonb;v_yes integer;v_no integer;v_submitted integer;v_revealed boolean;
begin
 select * into s from private.yesno_sessions where id=p_session;
 select count(*) into v_submitted from private.yesno_answers where session_id=s.id and round_index=s.round_index;
 v_revealed:=s.phase='result' and s.answers_revealed_round=s.round_index;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'ready',p.ready,'submitted',exists(select 1 from private.yesno_answers a where a.session_id=s.id and a.round_index=s.round_index and a.player_id=p.id),'score',coalesce(t.score,0)) order by coalesce(t.score,0) desc,lower(p.name),p.id),'[]') into players
 from private.yesno_players p left join lateral(select sum(points) score from private.yesno_answers a where a.session_id=s.id and a.player_id=p.id) t on true where p.session_id=s.id;
 select jsonb_build_object('answer',answer,'estimate',estimate) into own from private.yesno_answers where session_id=s.id and round_index=s.round_index and player_id=p_player;
 if s.phase='result' then
  select count(*) filter(where answer),count(*) filter(where not answer) into v_yes,v_no from private.yesno_answers where session_id=s.id and round_index=s.round_index;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'estimate',a.estimate,'points',coalesce(a.points,0),'exact',coalesce(a.estimate=v_yes,false)) || case when v_revealed then jsonb_build_object('answer',a.answer) else '{}'::jsonb end order by coalesce(a.points,0) desc,lower(p.name),p.id),'[]') into results from private.yesno_players p left join private.yesno_answers a on a.session_id=p.session_id and a.player_id=p.id and a.round_index=s.round_index where p.session_id=s.id;
 end if;
 return jsonb_build_object('ok',true,'session_id',s.id,'title',s.title,'join_code',s.join_code,'phase',s.phase,'round_index',s.round_index,'round_count',jsonb_array_length(s.questions),'seconds',s.seconds,'exact_points',s.exact_points,'near_points',s.near_points,'tolerance',s.tolerance,'reveal_answers',v_revealed,'can_evaluate',s.phase='question' and (coalesce(s.deadline<=clock_timestamp(),false) or v_submitted>=s.player_count),'deadline',s.deadline,'server_now',clock_timestamp(),'revision',s.revision,
 'question',case when s.phase in ('lobby','finished','ended') then null else s.questions->s.round_index->>'question' end,'player_count',case when s.phase='lobby' then jsonb_array_length(players) else s.player_count end,'players',players,'own_answer',own,'yes_count',v_yes,'no_count',v_no,'results',coalesce(results,'[]'));
end;$$;

create or replace function private.yesno_api_host_action(p_session_id uuid,p_round integer,p_phase text,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.yesno_sessions%rowtype;v_count integer;v_yes integer;
begin
 select * into s from private.yesno_sessions where id=p_session_id and owner_id=auth.uid() for update;
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 if p_action='end' then
  if s.phase not in ('ended','finished') then update private.yesno_sessions set phase='ended',deadline=null where id=s.id;perform private.yesno_touch(s.id);end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_round is null or p_phase is null or p_round<>s.round_index or p_phase<>s.phase then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 if p_action='start' and s.phase='lobby' then
  select count(*) into v_count from private.yesno_players where session_id=s.id;
  if v_count<2 then return jsonb_build_object('ok',false,'error','NEED_TWO_PLAYERS');end if;
  if exists(select 1 from private.yesno_players where session_id=s.id and not ready) then return jsonb_build_object('ok',false,'error','NOT_ALL_READY');end if;
  update private.yesno_sessions set phase='question',player_count=v_count,answers_revealed_round=-1,deadline=clock_timestamp()+make_interval(secs=>seconds) where id=s.id;
 elsif p_action='evaluate' and s.phase='question' then
  select count(*),count(*) filter(where answer) into v_count,v_yes from private.yesno_answers where session_id=s.id and round_index=s.round_index;
  if v_count<s.player_count and (s.deadline is null or s.deadline>clock_timestamp()) then return jsonb_build_object('ok',false,'error','WAITING_FOR_ANSWERS');end if;
  update private.yesno_answers set points=case when estimate=v_yes then s.exact_points when abs(estimate-v_yes)<=s.tolerance then s.near_points else 0 end where session_id=s.id and round_index=s.round_index;
  update private.yesno_sessions set phase='result',deadline=null,answers_revealed_round=-1 where id=s.id;
 elsif p_action='reveal_answers' and s.phase='result' then
  if s.answers_revealed_round=s.round_index then return jsonb_build_object('ok',true);end if;
  update private.yesno_sessions set answers_revealed_round=round_index where id=s.id;
 elsif p_action='next' and s.phase='result' then
  if s.round_index+1=jsonb_array_length(s.questions) then
   update private.yesno_sessions set phase='finished',deadline=null where id=s.id;
  else
   update private.yesno_sessions set phase='question',round_index=round_index+1,answers_revealed_round=-1,deadline=clock_timestamp()+make_interval(secs=>seconds) where id=s.id;
  end if;
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION');end if;
 perform private.yesno_touch(s.id);return jsonb_build_object('ok',true);
end;$$;
notify pgrst,'reload schema';
