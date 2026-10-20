-- Run only after yesno-db.sql in a dedicated test database.
do $$
declare teacher uuid:=gen_random_uuid();sid uuid;code text;a uuid;b uuid;c uuid;j jsonb;st jsonb;visibility boolean;tol integer;
begin
 insert into auth.users values(teacher);
 perform set_config('request.jwt.claim.sub',teacher::text,false);
 assert not has_function_privilege('anon','public.yesno_create_configured(uuid,uuid,integer,integer,integer,integer,integer,boolean,text[])','execute');
 assert public.yesno_create_configured(gen_random_uuid(),null,1,60,3,1,-1,false)->>'error'='INVALID_SETTINGS';
 for tol in 0..2 loop
  foreach visibility in array array[false,true] loop
   j:=public.yesno_create_configured(gen_random_uuid(),null,1,60,3,1,tol,visibility);assert (j->>'ok')::boolean;
   sid:=(j->>'session_id')::uuid;code:=j->>'join_code';
   a:=(public.yesno_join(code,'Ada',repeat('a',64))->>'player_id')::uuid;
   b:=(public.yesno_join(code,'Ben',repeat('b',64))->>'player_id')::uuid;
   c:=(public.yesno_join(code,'Cleo',repeat('c',64))->>'player_id')::uuid;
   perform public.yesno_ready(sid,a,repeat('a',64),true);perform public.yesno_ready(sid,b,repeat('b',64),true);perform public.yesno_ready(sid,c,repeat('c',64),true);
   perform public.yesno_host_action(sid,0,'lobby','start');
   perform public.yesno_submit(sid,a,repeat('a',64),0,true,1);
   st:=public.yesno_host_state(sid);assert st->'results'='[]'::jsonb;assert st->'yes_count'='null'::jsonb;assert not (st->'players'->0 ? 'answer');
   perform public.yesno_submit(sid,b,repeat('b',64),0,false,3);
   perform public.yesno_submit(sid,c,repeat('c',64),0,false,0);
   st:=public.yesno_host_state(sid);assert st->>'phase'='finished';assert (st->>'tolerance')::integer=tol;assert (st->>'reveal_answers')::boolean=visibility;
   assert (select points=3 from private.yesno_answers where player_id=a);
   assert (select points=case when tol>=2 then 1 else 0 end from private.yesno_answers where player_id=b);
   assert (select points=case when tol>=1 then 1 else 0 end from private.yesno_answers where player_id=c);
   assert not exists(select 1 from jsonb_array_elements(st->'results') r where (r ? 'answer')<>visibility);
   if visibility then assert (select (r->>'answer')::boolean from jsonb_array_elements(st->'results') r where r->>'name'='Ada');end if;
  end loop;
 end loop;
end;$$;
