-- Apply after bluff.sql and bluff_library.sql. Input, anonymous preview and voting are separate phases.
alter table private.bluff_sessions drop constraint if exists bluff_sessions_phase_check;
alter table private.bluff_sessions add constraint bluff_sessions_phase_check check(phase in ('lobby','question','bluff','answers','vote','reveal','leaderboard','ended'));
create or replace function private.bluff_state(p_session uuid,p_player uuid,p_host boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.bluff_sessions%rowtype;r private.bluff_rounds%rowtype;players jsonb;opts jsonb;entries jsonb;own jsonb;voted uuid;begin
 select * into s from private.bluff_sessions where id=p_session;
 if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND');end if;
 select * into r from private.bluff_rounds where session_id=s.id and round_index=s.round_index;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'score',p.score,'submitted',exists(select 1 from private.bluff_entries e where e.session_id=s.id and e.round_index=s.round_index and e.player_id=p.id),'voted',exists(select 1 from private.bluff_votes v where v.session_id=s.id and v.round_index=s.round_index and v.player_id=p.id)) order by p.score desc,lower(p.name),p.id),'[]') into players from private.bluff_players p where p.session_id=s.id;
 if s.phase in ('answers','vote','reveal','leaderboard','ended') then
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'answer',o.answer,'own',coalesce(p_player=any(o.author_ids),false),'revealed',o.position<r.reveal_count)||case when o.position<r.reveal_count then jsonb_build_object('is_truth',o.is_truth,'authors',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name),'[]') from private.bluff_players p where p.id=any(o.author_ids)),'voters',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name),'[]') from private.bluff_votes v join private.bluff_players p on p.id=v.player_id where v.option_id=o.id)) else '{}'::jsonb end order by o.position),'[]') into opts from private.bluff_options o where o.session_id=s.id and o.round_index=s.round_index;
 end if;
 select jsonb_build_object('answer',answer) into own from private.bluff_entries where session_id=s.id and round_index=s.round_index and player_id=p_player;
 select option_id into voted from private.bluff_votes where session_id=s.id and round_index=s.round_index and player_id=p_player;
 return jsonb_build_object('ok',true,'session_id',s.id,'join_code',s.join_code,'phase',s.phase,'round_index',s.round_index,'round_count',s.round_count,'revision',s.revision,'deadline',s.deadline,'server_now',clock_timestamp(),'reveal_count',r.reveal_count,'question',case when s.phase='lobby' then null else r.question end,'category',case when s.phase='lobby' then null else r.category end,'source_url',case when s.phase in ('leaderboard','ended') then r.source_url else null end,'correct_answer',case when s.phase='leaderboard' then r.correct_answer else null end,'players',players,'options',coalesce(opts,'[]'),'entries',coalesce(entries,'[]'),'own_entry',own,'own_vote',voted);
end;$$;
create or replace function public.bluff_host_action(p_session_id uuid,p_round integer,p_phase text,p_action text,p_seconds integer default null,p_reveal_count integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.bluff_sessions%rowtype;r private.bluff_rounds%rowtype;n integer;act text:=p_action;begin
 select * into s from private.bluff_sessions where id=p_session_id for update;
 if not found or s.owner_id is distinct from auth.uid() then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 if act='end' then
 if s.phase<>'ended' then update private.bluff_sessions set phase='ended',deadline=null where id=s.id;perform private.bluff_touch(s.id);end if;
 return jsonb_build_object('ok',true);end if;
 if p_round is null or p_phase is null or p_round<>s.round_index or p_phase<>s.phase then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 select * into r from private.bluff_rounds where session_id=s.id and round_index=s.round_index for update;
 if act='expire' then
 if s.deadline is null or clock_timestamp()<s.deadline then return jsonb_build_object('ok',true);end if;
 -- Input expiry never publishes answers or starts voting automatically.
 if s.phase='bluff' then return jsonb_build_object('ok',true);end if;
 act:=case s.phase when 'vote' then 'reveal' else '' end;
 end if;
 if act='timer' and s.phase in ('bluff','vote') then
 if p_seconds is not null and p_seconds not between 5 and 600 then return jsonb_build_object('ok',false,'error','INVALID_TIMER');end if;
 update private.bluff_sessions set deadline=case when p_seconds is null then null else clock_timestamp()+make_interval(secs=>p_seconds) end where id=s.id;
 elsif act='start' and s.phase='lobby' then
 if (select count(*) from private.bluff_players where session_id=s.id)<2 then return jsonb_build_object('ok',false,'error','NEED_TWO_PLAYERS');end if;
 update private.bluff_sessions set phase='bluff',deadline=null where id=s.id;
 elsif act='open_bluff' and s.phase='question' then
 update private.bluff_sessions set phase='bluff',deadline=null where id=s.id;
 elsif act in ('show_answers','open_vote') and s.phase='bluff' then
 if not exists(select 1 from private.bluff_entries where session_id=s.id and round_index=s.round_index) then return jsonb_build_object('ok',false,'error','NO_BLUFFS');end if;
 if exists(select 1 from private.bluff_players p where p.session_id=s.id and not exists(select 1 from private.bluff_entries e where e.session_id=s.id and e.round_index=s.round_index and e.player_id=p.id)) then return jsonb_build_object('ok',false,'error','WAITING_FOR_ANSWERS');end if;
 insert into private.bluff_options(session_id,round_index,answer,is_truth,author_ids,position)
 select s.id,s.round_index,q.answer,q.truth,q.authors,(row_number() over(order by random())-1)::integer from (
 select r.correct_answer as answer,true as truth,'{}'::uuid[] as authors
 union all select min(e.answer),false,array_agg(e.player_id) from private.bluff_entries e where e.session_id=s.id and e.round_index=s.round_index group by private.bluff_normalize(e.answer)) q;
 update private.bluff_sessions set phase='answers',deadline=null where id=s.id;
 elsif act='start_vote' and s.phase='answers' then
 update private.bluff_sessions set phase='vote',deadline=null where id=s.id;
 elsif act='reveal' and s.phase='vote' then
 update private.bluff_sessions set phase='reveal',deadline=null where id=s.id;
 elsif act='reveal_next' and s.phase='reveal' then
 if p_reveal_count is null or p_reveal_count<>r.reveal_count then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 select count(*) into n from private.bluff_options where session_id=s.id and round_index=s.round_index;
 update private.bluff_rounds set reveal_count=reveal_count+1 where session_id=s.id and round_index=s.round_index;
 if r.reveal_count+1>=n and r.scored_at is null then
 update private.bluff_players p set score=score+coalesce((select sum(case when o.is_truth and v.player_id=p.id then 1 when not o.is_truth and p.id=any(o.author_ids) then 2 else 0 end) from private.bluff_votes v join private.bluff_options o on o.id=v.option_id where v.session_id=s.id and v.round_index=s.round_index),0)::integer where p.session_id=s.id;
 update private.bluff_rounds set scored_at=clock_timestamp() where session_id=s.id and round_index=s.round_index;
 update private.bluff_sessions set phase='leaderboard' where id=s.id;
 end if;
 elsif act='next' and s.phase='leaderboard' then
 update private.bluff_sessions set phase=case when round_index+1>=round_count then 'ended' else 'bluff' end,round_index=case when round_index+1>=round_count then round_index else round_index+1 end,deadline=null where id=s.id;
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION');end if;
 perform private.bluff_touch(s.id);return jsonb_build_object('ok',true);
end;$$;

-- Existing rooms paused at the old question-only step can accept entries immediately.
do $$declare sid uuid;begin
 for sid in update private.bluff_sessions set phase='bluff',deadline=null where phase='question' returning id loop
 perform private.bluff_touch(sid);
 end loop;
end;$$;
revoke all on function private.bluff_state(uuid,uuid,boolean) from public,anon,authenticated;
