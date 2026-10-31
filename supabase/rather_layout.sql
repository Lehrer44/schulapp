-- Apply after rather.sql. Synchronized, per-person result reveal; direct next round.
alter table private.rather_sessions add column if not exists result_reveals uuid[] not null default '{}';
create or replace function private.rather_api(p_action text,a jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();s private.rather_sessions%rowtype;p private.rather_players%rowtype;
 sid uuid;pid uuid;qid bigint;qs jsonb;ids bigint[];code text;txt text;j jsonb;own uuid;target uuid;
 n integer;max_votes integer;changed boolean:=false;
begin
 if p_action not in ('join','player_state','vote') and uid is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_action in ('question_list','question_save','question_delete','quiz_list','quiz_save','quiz_delete','quiz_start','create') then
  -- Seed once per account, so editing/deleting a starter never affects another teacher.
  insert into private.rather_catalogs values(uid) on conflict do nothing;
  if found then
   insert into private.rather_questions(owner_id,question) select uid,x from unnest(array[
    'Wer würde eher einen Laden überfallen?','Wer würde eher eine Weltreise machen?',
    'Wer würde eher einen Film drehen?','Wer würde eher ein eigenes Unternehmen gründen?',
    'Wer würde eher auf einer einsamen Insel überleben?','Wer würde eher einen Marathon laufen?',
    'Wer würde eher einen Geburtstag vergessen?','Wer würde eher ein Buch schreiben?',
    'Wer würde eher auf dem Mars leben?','Wer würde eher eine berühmte Erfindung machen?']) x;
  end if;
 end if;
 if p_action='question_list' then
  return jsonb_build_object('ok',true,'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question) order by id),'[]') from private.rather_questions where owner_id=uid));
 elsif p_action='question_save' then
  txt:=btrim(a->>'p_question');qid:=(a->>'p_id')::bigint;
  if txt is null or length(txt) not between 5 and 500 then return jsonb_build_object('ok',false,'error','INVALID_QUESTION');end if;
  if qid is null then insert into private.rather_questions(owner_id,question) values(uid,txt) returning id into qid;
  else update private.rather_questions set question=txt where id=qid and owner_id=uid;
   if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
  end if;
  return jsonb_build_object('ok',true,'id',qid);
 elsif p_action='question_delete' then
  delete from private.rather_questions where id=(a->>'p_id')::bigint and owner_id=uid;
  if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 elsif p_action='quiz_list' then
  return jsonb_build_object('ok',true,'quizzes',(select coalesce(jsonb_agg(to_jsonb(q) order by q.name),'[]') from (select id,name,questions from private.rather_quizzes where owner_id=uid) q));
 elsif p_action='quiz_delete' then
  delete from private.rather_quizzes where id=(a->>'p_id')::uuid and owner_id=uid;
  if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 elsif p_action in ('quiz_save','create','quiz_start') then
  if p_action='quiz_start' then
   select questions into qs from private.rather_quizzes where id=(a->>'p_id')::uuid and owner_id=uid;
   if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
  else
   select array_agg(x::bigint) into ids from jsonb_array_elements_text(nullif(a->'p_question_ids','null')) x;
   n:=case when p_action='quiz_save' then cardinality(ids) else (a->>'p_round_count')::integer end;
   if n is null or n not between 1 and 50 then return jsonb_build_object('ok',false,'error','INVALID_ROUND_COUNT');end if;
   if ids is not null then
    if cardinality(ids)<>n or (select count(distinct x) from unnest(ids) x)<>n or exists(select 1 from unnest(ids) x where not exists(select 1 from private.rather_questions where id=x and owner_id=uid) and not (p_action='quiz_save' and exists(select 1 from private.rather_quizzes q cross join lateral jsonb_array_elements(q.questions) v where q.id=(a->>'p_id')::uuid and q.owner_id=uid and (v->>'id')::bigint=x))) then
     return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
    select jsonb_agg(coalesce((select jsonb_build_object('id',id,'question',question) from private.rather_questions where id=x and owner_id=uid),(select v from private.rather_quizzes q cross join lateral jsonb_array_elements(q.questions) v where q.id=(a->>'p_id')::uuid and q.owner_id=uid and (v->>'id')::bigint=x)) order by ord) into qs from unnest(ids) with ordinality t(x,ord);
   else
    select jsonb_agg(jsonb_build_object('id',id,'question',question)) into qs from (select * from private.rather_questions where owner_id=uid order by random() limit n) q;
    if coalesce(jsonb_array_length(qs),0)<>n then return jsonb_build_object('ok',false,'error','NOT_ENOUGH_QUESTIONS');end if;
   end if;
  end if;
  if p_action='quiz_save' then
   txt:=btrim(a->>'p_name');sid:=(a->>'p_id')::uuid;
   if txt is null or length(txt) not between 1 and 120 then return jsonb_build_object('ok',false,'error','INVALID_NAME');end if;
   if sid is null then insert into private.rather_quizzes(owner_id,name,questions) values(uid,txt,qs);
   else update private.rather_quizzes set name=txt,questions=qs where id=sid and owner_id=uid;
    if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
   end if;
  else
   loop
    code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
    exit when not exists(select 1 from private.rather_sessions where join_code=code);
   end loop;
   insert into private.rather_sessions(owner_id,join_code,questions) values(uid,code,qs) returning id into sid;
   insert into public.rather_live_signals values(sid,1);
   return jsonb_build_object('ok',true,'session_id',sid,'join_code',code);
  end if;
 elsif p_action in ('join','host_state','player_state','host_action','vote') then
  if p_action='join' then
   if not private.classroom_join_allowed('rather') then return jsonb_build_object('ok',false,'error','JOIN_RATE_LIMITED');end if;
   select * into s from private.rather_sessions where join_code=upper(btrim(a->>'p_code')) for update;
  else select * into s from private.rather_sessions where id=(a->>'p_session_id')::uuid for update;end if;
  if not found then return jsonb_build_object('ok',false,'error','SESSION_NOT_FOUND');end if;
  if p_action in ('host_state','host_action') then
   if s.owner_id is distinct from uid then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
  else
   if coalesce(a->>'p_token','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN');end if;
   if p_action='join' then
    select * into p from private.rather_players where session_id=s.id and token_hash=encode(sha256(convert_to(a->>'p_token','UTF8')),'hex');
    if not found then
     if s.phase<>'lobby' then return jsonb_build_object('ok',false,'error','GAME_ALREADY_STARTED');end if;
     txt:=btrim(a->>'p_name');
     if txt is null or length(txt) not between 1 and 40 then return jsonb_build_object('ok',false,'error','INVALID_JOIN_INPUT');end if;
     if (select count(*) from private.rather_players where session_id=s.id)>=50 then return jsonb_build_object('ok',false,'error','ROOM_FULL');end if;
     if exists(select 1 from private.rather_players where session_id=s.id and lower(name)=lower(txt)) then return jsonb_build_object('ok',false,'error','NAME_TAKEN');end if;
     insert into private.rather_players(session_id,name,token_hash) values(s.id,txt,encode(sha256(convert_to(a->>'p_token','UTF8')),'hex')) returning * into p;
     changed:=true;
    end if;
   else
    select * into p from private.rather_players where id=(a->>'p_player_id')::uuid and session_id=s.id and token_hash=encode(sha256(convert_to(a->>'p_token','UTF8')),'hex');
    if not found then return jsonb_build_object('ok',false,'error','INVALID_PARTICIPANT_TOKEN');end if;
   end if;
   pid:=p.id;
  end if;
  if p_action='vote' then
   if s.phase<>'vote' or (a->>'p_round')::integer is distinct from s.round_index then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
   target:=(a->>'p_target_id')::uuid;
   if not exists(select 1 from private.rather_players where id=target and session_id=s.id) then return jsonb_build_object('ok',false,'error','INVALID_OPTION');end if;
   select target_id into own from private.rather_votes where session_id=s.id and round_index=s.round_index and player_id=pid;
   if found then
    if own<>target then return jsonb_build_object('ok',false,'error','VOTE_ALREADY_CAST');end if;
   else insert into private.rather_votes values(s.id,s.round_index,pid,target);changed:=true;end if;
  elsif p_action='host_action' then
   txt:=a->>'p_action';
   if txt='end' then
    if s.phase<>'ended' then update private.rather_sessions set phase='ended' where id=s.id;changed:=true;end if;
   else
    if (a->>'p_round')::integer is distinct from s.round_index or a->>'p_phase' is distinct from s.phase then return jsonb_build_object('ok',false,'error','PHASE_CHANGED');end if;
    if txt='start' and s.phase='lobby' then
     if (select count(*) from private.rather_players where session_id=s.id)<2 then return jsonb_build_object('ok',false,'error','NEED_TWO_PLAYERS');end if;
     update private.rather_sessions set phase='vote' where id=s.id;
    elsif txt='show_bars' and s.phase='vote' then update private.rather_sessions set phase='bars',result_reveals='{}' where id=s.id;
    elsif txt='reveal_result' and s.phase='bars' then
     target:=(a->>'p_target_id')::uuid;
     if not exists(select 1 from private.rather_players where id=target and session_id=s.id) then return jsonb_build_object('ok',false,'error','INVALID_OPTION');end if;
     if target=any(s.result_reveals) then return jsonb_build_object('ok',true);end if;
     update private.rather_sessions set result_reveals=array_append(result_reveals,target) where id=s.id;
    elsif txt='reveal' and s.phase='bars' then
     select max(c) into max_votes from (select count(*) c from private.rather_votes where session_id=s.id and round_index=s.round_index group by target_id) v;
     update private.rather_players pl set score=score+1 where pl.session_id=s.id and exists(
      select 1 from private.rather_votes v where v.session_id=s.id and v.round_index=s.round_index and v.player_id=pl.id
      and (select count(*) from private.rather_votes w where w.session_id=s.id and w.round_index=s.round_index and w.target_id=v.target_id)=max_votes);
     update private.rather_sessions set phase='reveal' where id=s.id;
    elsif txt='scores' and s.phase='reveal' then update private.rather_sessions set phase='leaderboard' where id=s.id;
    elsif txt='next' and s.phase in ('reveal','leaderboard') then
     update private.rather_sessions set phase=case when round_index+1=jsonb_array_length(questions) then 'ended' else 'vote' end,
      round_index=least(round_index+1,jsonb_array_length(questions)-1),result_reveals='{}' where id=s.id;
    else return jsonb_build_object('ok',false,'error','INVALID_ACTION');end if;
    changed:=true;
   end if;
  end if;
  if changed then
   update private.rather_sessions set revision=revision+1 where id=s.id returning * into s;
   update public.rather_live_signals set revision=s.revision where session_id=s.id;
  end if;
  if p_action='join' then return jsonb_build_object('ok',true,'session_id',s.id,'player_id',pid,'name',p.name,'join_code',s.join_code);end if;
  if p_action in ('host_state','player_state') then
   return jsonb_build_object('ok',true,'session_id',s.id,'join_code',s.join_code,'revision',s.revision,'phase',s.phase,'round_index',s.round_index,'round_count',jsonb_array_length(s.questions),
    'question',case when s.phase not in ('lobby','ended') then s.questions->s.round_index->>'question' end,
    'own_vote',(select target_id from private.rather_votes where session_id=s.id and round_index=s.round_index and player_id=pid),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'score',score,'voted',exists(select 1 from private.rather_votes where session_id=s.id and round_index=s.round_index and player_id=pl.id)) order by score desc,joined_at,id),'[]') from private.rather_players pl where session_id=s.id),
    'results',case when s.phase in ('bars','reveal','leaderboard') then (select coalesce(jsonb_agg(jsonb_build_object('id',pl.id,'name',pl.name,'revealed',s.phase in ('reveal','leaderboard') or pl.id=any(s.result_reveals),'count',case when s.phase in ('reveal','leaderboard') or pl.id=any(s.result_reveals) then (select count(*) from private.rather_votes where session_id=s.id and round_index=s.round_index and target_id=pl.id) end) || case when s.phase in ('reveal','leaderboard') then jsonb_build_object('voters',(select coalesce(jsonb_agg(jsonb_build_object('id',voter.id,'name',voter.name) order by voter.joined_at),'[]') from private.rather_votes v join private.rather_players voter on voter.id=v.player_id where v.session_id=s.id and v.round_index=s.round_index and v.target_id=pl.id)) else '{}'::jsonb end order by pl.joined_at,pl.id),'[]') from private.rather_players pl where pl.session_id=s.id) else '[]'::jsonb end);
  end if;
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION');
 end if;
 return jsonb_build_object('ok',true);
end;$$;

create or replace function public.rather_reveal_result(p_session_id uuid,p_round integer,p_target_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.rather_api('host_action',jsonb_build_object('p_session_id',p_session_id,'p_round',p_round,'p_phase','bars','p_action','reveal_result','p_target_id',p_target_id));
$$;
revoke all on function public.rather_reveal_result(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.rather_reveal_result(uuid,integer,uuid) to authenticated;

notify pgrst,'reload schema';
