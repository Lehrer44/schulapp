-- Apply after bluff_flow.sql. Reveal the complete round atomically.
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
 elsif (act='reveal' and s.phase='vote') or (act='reveal_next' and s.phase='reveal') then
 -- One transaction discloses every option and awards the round exactly once.
 if s.phase='reveal' and (p_reveal_count is null or p_reveal_count<>r.reveal_count) then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
 select count(*) into n from private.bluff_options where session_id=s.id and round_index=s.round_index;
 update private.bluff_rounds set reveal_count=n where session_id=s.id and round_index=s.round_index;
 if r.scored_at is null then
 update private.bluff_players p set score=score+coalesce((select sum(case when o.is_truth and v.player_id=p.id then 1 when not o.is_truth and p.id=any(o.author_ids) then 2 else 0 end) from private.bluff_votes v join private.bluff_options o on o.id=v.option_id where v.session_id=s.id and v.round_index=s.round_index),0)::integer where p.session_id=s.id;
 update private.bluff_rounds set scored_at=clock_timestamp() where session_id=s.id and round_index=s.round_index;
 end if;
 update private.bluff_sessions set phase='leaderboard',deadline=null where id=s.id;
 elsif act='next' and s.phase='leaderboard' then
 update private.bluff_sessions set phase=case when round_index+1>=round_count then 'ended' else 'bluff' end,round_index=case when round_index+1>=round_count then round_index else round_index+1 end,deadline=null where id=s.id;
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION');end if;
 perform private.bluff_touch(s.id);return jsonb_build_object('ok',true);
end;$$;

