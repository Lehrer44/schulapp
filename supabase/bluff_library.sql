-- Apply after bluff.sql. Private, account-owned libraries and editable starter questions.
create table if not exists private.bluff_hidden_questions(
 owner_id uuid references auth.users(id) on delete cascade,
 question_id bigint references private.bluff_questions(id) on delete cascade,
 primary key(owner_id,question_id)
);
create table if not exists private.bluff_quizzes(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 120),
 questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 50),
 updated_at timestamptz not null default now()
);
create index if not exists bluff_quizzes_owner_idx on private.bluff_quizzes(owner_id,updated_at desc);
alter table private.bluff_hidden_questions enable row level security;
alter table private.bluff_quizzes enable row level security;
revoke all on private.bluff_hidden_questions,private.bluff_quizzes from public,anon,authenticated;
create or replace function private.bluff_available_questions()
returns setof private.bluff_questions language sql stable security definer set search_path='' as $$
 select q.* from private.bluff_questions q
 where (q.owner_id=auth.uid() or q.owner_id is null)
 and not exists(select 1 from private.bluff_hidden_questions h where h.owner_id=auth.uid() and h.question_id=q.id)
$$;
create or replace function public.bluff_question_list()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 return jsonb_build_object('ok',true,'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'correct_answer',correct_answer,'category',category,'source_url',source_url,'editable',true) order by id),'[]') from private.bluff_available_questions()));
end;$$;
create or replace function public.bluff_question_save(p_id bigint,p_question text,p_correct_answer text,p_category text,p_source_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare qid bigint;begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_question is null or length(btrim(p_question)) not between 5 and 500 or p_correct_answer is null or length(btrim(p_correct_answer)) not between 1 and 180 or length(coalesce(p_category,''))>80 or length(coalesce(p_source_url,''))>1000 or (coalesce(p_source_url,'')<>'' and p_source_url !~ '^https://[^[:space:]]+$') then return jsonb_build_object('ok',false,'error','INVALID_QUESTION');end if;
 if p_id is null then
 insert into private.bluff_questions(owner_id,question,correct_answer,category,source_url) values(auth.uid(),btrim(p_question),btrim(p_correct_answer),coalesce(p_category,''),coalesce(p_source_url,'')) returning id into qid;
 elsif exists(select 1 from private.bluff_questions where id=p_id and owner_id is null) then
 insert into private.bluff_questions(owner_id,question,correct_answer,category,source_url) values(auth.uid(),btrim(p_question),btrim(p_correct_answer),coalesce(p_category,''),coalesce(p_source_url,'')) returning id into qid;
 insert into private.bluff_hidden_questions values(auth.uid(),p_id) on conflict do nothing;
 else
 update private.bluff_questions set question=btrim(p_question),correct_answer=btrim(p_correct_answer),category=coalesce(p_category,''),source_url=coalesce(p_source_url,''),updated_at=now() where id=p_id and owner_id=auth.uid() returning id into qid;
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 end if;
 return jsonb_build_object('ok',true,'id',qid);
end;$$;
create or replace function public.bluff_question_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if exists(select 1 from private.bluff_questions where id=p_id and owner_id is null) then
 insert into private.bluff_hidden_questions values(auth.uid(),p_id) on conflict do nothing;
 return jsonb_build_object('ok',true);
 end if;
 delete from private.bluff_questions where id=p_id and owner_id=auth.uid();
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 return jsonb_build_object('ok',true);
end;$$;

create or replace function public.bluff_create(p_round_count integer,p_question_ids bigint[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;code text;ids bigint[];begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_round_count is null or p_round_count not between 1 and 50 then return jsonb_build_object('ok',false,'error','INVALID_ROUND_COUNT');end if;
 if p_question_ids is not null then
 if cardinality(p_question_ids)<>p_round_count or cardinality(p_question_ids)<>(select count(distinct x) from unnest(p_question_ids) x) or exists(select 1 from unnest(p_question_ids) x where not exists(select 1 from private.bluff_available_questions() where id=x and (owner_id=auth.uid() or owner_id is null))) then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 if (select count(distinct private.bluff_normalize(question)) from private.bluff_available_questions() where id=any(p_question_ids))<>p_round_count then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 ids:=p_question_ids;
 else
 select array_agg(id) into ids from (select id from (
 select distinct on (private.bluff_normalize(question)) id from private.bluff_available_questions()
 where owner_id=auth.uid() or owner_id is null
 order by private.bluff_normalize(question),(owner_id is not null) desc,id desc
 ) unique_questions order by random() limit p_round_count) q;
 if coalesce(cardinality(ids),0)<>p_round_count then return jsonb_build_object('ok',false,'error','NOT_ENOUGH_QUESTIONS');end if;
 end if;
 for attempt in 1..30 loop
 code:='';for pos in 1..5 loop code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+floor(random()*32)::int,1);end loop;
 begin
 insert into private.bluff_sessions(owner_id,join_code,round_count) values(auth.uid(),code,p_round_count) returning id into sid;exit;
 exception when unique_violation then sid:=null;end;
 end loop;
 if sid is null then return jsonb_build_object('ok',false,'error','CODE_GENERATION_FAILED');end if;
 insert into private.bluff_rounds(session_id,round_index,question,correct_answer,category,source_url)
 select sid,(i.n-1)::integer,q.question,q.correct_answer,q.category,q.source_url from unnest(ids) with ordinality i(id,n) join private.bluff_available_questions() q on q.id=i.id;
 perform private.bluff_touch(sid);
 return jsonb_build_object('ok',true,'session_id',sid,'join_code',code);
end;$$;
create or replace function private.bluff_create_saved(p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;code text;begin
 for attempt in 1..30 loop
 code:='';for pos in 1..5 loop code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+floor(random()*32)::int,1);end loop;
 begin
 insert into private.bluff_sessions(owner_id,join_code,round_count) values(auth.uid(),code,jsonb_array_length(p_questions)) returning id into sid;exit;
 exception when unique_violation then sid:=null;end;
 end loop;
 if sid is null then return jsonb_build_object('ok',false,'error','CODE_GENERATION_FAILED');end if;
 insert into private.bluff_rounds(session_id,round_index,question,correct_answer,category,source_url)
 select sid,(n-1)::integer,q->>'question',q->>'correct_answer',coalesce(q->>'category',''),coalesce(q->>'source_url','') from jsonb_array_elements(p_questions) with ordinality x(q,n);
 perform private.bluff_touch(sid);
 return jsonb_build_object('ok',true,'session_id',sid,'join_code',code);
end;$$;
create or replace function public.bluff_quiz_list()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 return jsonb_build_object('ok',true,'quizzes',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'questions',questions) order by updated_at desc,id),'[]') from private.bluff_quizzes where owner_id=auth.uid()));
end;$$;
create or replace function public.bluff_quiz_save(p_id uuid,p_name text,p_question_ids bigint[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_questions jsonb:='[]';chosen jsonb;v_id uuid;begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 if p_id is not null then
 select questions into old_questions from private.bluff_quizzes where id=p_id and owner_id=auth.uid() for update;
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 then return jsonb_build_object('ok',false,'error','INVALID_NAME');end if;
 if p_question_ids is null or cardinality(p_question_ids) not between 1 and 50 or cardinality(p_question_ids)<>(select count(distinct x) from unnest(p_question_ids) x) then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 -- Prefer the current question bank; retain deleted questions already in this owner's saved quiz.
 select jsonb_agg(coalesce((select jsonb_build_object('id',q.id,'question',q.question,'correct_answer',q.correct_answer,'category',q.category,'source_url',q.source_url) from private.bluff_available_questions() q where q.id=i.id),
 (select q from jsonb_array_elements(old_questions) q where (q->>'id')::bigint=i.id limit 1)) order by n) into chosen from unnest(p_question_ids) with ordinality i(id,n);
 if exists(select 1 from jsonb_array_elements(chosen) q where q='null'::jsonb) or (select count(distinct private.bluff_normalize(q->>'question')) from jsonb_array_elements(chosen) q)<>cardinality(p_question_ids) then return jsonb_build_object('ok',false,'error','INVALID_SELECTION');end if;
 if p_id is null then insert into private.bluff_quizzes(owner_id,name,questions) values(auth.uid(),btrim(p_name),chosen) returning id into v_id;
 else update private.bluff_quizzes set name=btrim(p_name),questions=chosen,updated_at=now() where id=p_id and owner_id=auth.uid() returning id into v_id;end if;
 return jsonb_build_object('ok',true,'id',v_id);
end;$$;
create or replace function public.bluff_quiz_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 delete from private.bluff_quizzes where id=p_id and owner_id=auth.uid();
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.bluff_quiz_start(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare qs jsonb;begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');end if;
 select questions into qs from private.bluff_quizzes where id=p_id and owner_id=auth.uid();
 if not found then return jsonb_build_object('ok',false,'error','NOT_OWNER');end if;
 return private.bluff_create_saved(qs);
end;$$;
revoke all on function private.bluff_available_questions(),private.bluff_create_saved(jsonb) from public,anon,authenticated;
revoke all on function public.bluff_quiz_list(),public.bluff_quiz_save(uuid,text,bigint[]),public.bluff_quiz_delete(uuid),public.bluff_quiz_start(uuid) from public,anon,authenticated;
grant execute on function public.bluff_quiz_list(),public.bluff_quiz_save(uuid,text,bigint[]),public.bluff_quiz_delete(uuid),public.bluff_quiz_start(uuid) to authenticated;
