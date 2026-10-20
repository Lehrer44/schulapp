-- Additive settings extension. Apply after yesno.sql. Existing games stay secret.
alter table private.yesno_sessions add column if not exists tolerance integer not null default 1 check(tolerance between 0 and 100);
alter table private.yesno_sessions add column if not exists reveal_answers boolean not null default false;
create or replace function private.yesno_api_create_configured(p_request_id uuid,p_game_id uuid,p_rounds integer,p_seconds integer,p_exact integer,p_near integer,p_tolerance integer,p_reveal_answers boolean,p_packs text[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pool jsonb;chosen jsonb;s private.yesno_sessions%rowtype;v_title text:='Zufälliges Ja/Nein-Spiel';code text;tries integer;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_tolerance is null or p_tolerance not between 0 and 100 or p_reveal_answers is null or p_request_id is null or p_rounds is null or p_rounds not between 1 and 50 or p_seconds is null or p_seconds not between 5 and 300 or p_exact is null or p_exact not between 0 and 100 or p_near is null or p_near not between 0 and 100 or p_near>p_exact then return jsonb_build_object('ok',false,'error','INVALID_SETTINGS');end if;
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
   insert into private.yesno_sessions(owner_id,request_id,join_code,title,questions,seconds,exact_points,near_points,tolerance,reveal_answers) values(auth.uid(),p_request_id,code,v_title,chosen,p_seconds,p_exact,p_near,p_tolerance,p_reveal_answers) returning * into s;
   exit;
  exception when unique_violation then if tries=20 then raise;end if;end;
 end loop;
 perform private.yesno_touch(s.id);
 return jsonb_build_object('ok',true,'session_id',s.id,'join_code',s.join_code);
end;$$;
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
 update private.yesno_answers set points=case when estimate=v_yes then s.exact_points when abs(estimate-v_yes)<=s.tolerance then s.near_points else 0 end where session_id=s.id and round_index=s.round_index;
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
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'estimate',a.estimate,'points',coalesce(a.points,0),'exact',coalesce(a.estimate=v_yes,false)) || case when s.reveal_answers then jsonb_build_object('answer',a.answer) else '{}'::jsonb end order by coalesce(a.points,0) desc,lower(p.name),p.id),'[]') into results from private.yesno_players p left join private.yesno_answers a on a.session_id=p.session_id and a.player_id=p.id and a.round_index=s.round_index where p.session_id=s.id;
 end if;
 return jsonb_build_object('ok',true,'session_id',s.id,'title',s.title,'join_code',s.join_code,'phase',s.phase,'round_index',s.round_index,'round_count',jsonb_array_length(s.questions),'seconds',s.seconds,'exact_points',s.exact_points,'near_points',s.near_points,'tolerance',s.tolerance,'reveal_answers',s.reveal_answers,'deadline',s.deadline,'server_now',clock_timestamp(),'revision',s.revision,
 'question',case when s.phase='lobby' then null else s.questions->s.round_index->>'question' end,'player_count',case when s.phase='lobby' then jsonb_array_length(players) else s.player_count end,'players',players,'own_answer',own,'yes_count',v_yes,'no_count',v_no,'results',coalesce(results,'[]'));
end;$$;
create or replace function public.yesno_create_configured(p_request_id uuid,p_game_id uuid,p_rounds integer,p_seconds integer,p_exact integer,p_near integer,p_tolerance integer,p_reveal_answers boolean,p_packs text[] default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.yesno_api_create_configured(p_request_id,p_game_id,p_rounds,p_seconds,p_exact,p_near,p_tolerance,p_reveal_answers,p_packs);
$$;
revoke all on function private.yesno_api_create_configured(uuid,uuid,integer,integer,integer,integer,integer,boolean,text[]) from public,anon;
revoke all on function public.yesno_create_configured(uuid,uuid,integer,integer,integer,integer,integer,boolean,text[]) from public,anon;
grant execute on function private.yesno_api_create_configured(uuid,uuid,integer,integer,integer,integer,integer,boolean,text[]) to authenticated;
grant execute on function public.yesno_create_configured(uuid,uuid,integer,integer,integer,integer,integer,boolean,text[]) to authenticated;
notify pgrst,'reload schema';
