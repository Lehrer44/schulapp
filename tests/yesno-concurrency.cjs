// Run after yesno-db.sql in the isolated test database, never against live data.
const {execFileSync,spawn}=require('node:child_process'),assert=require('node:assert/strict');
const quote=x=>"'"+String(x).replace(/'/g,"''")+"'";
const owner='22222222-2222-4222-8222-222222222222';
function sql(q){return execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1);}
function parallel(q){return new Promise((resolve,reject)=>{const p=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));});}
(async()=>{
 sql('insert into auth.users values('+quote(owner)+') on conflict do nothing');
 const game=JSON.parse(sql("select set_config('request.jwt.claim.sub',"+quote(owner)+",false);select public.yesno_create(gen_random_uuid(),null,1,30,3,1,null)"));
 const players=['Ada','Ben','Cleo'].map((name,i)=>JSON.parse(sql('select public.yesno_join('+quote(game.join_code)+','+quote(name)+','+quote(String(i+1).repeat(64))+')')));
 players.forEach((p,i)=>sql('select public.yesno_ready('+quote(game.session_id)+','+quote(p.player_id)+','+quote(String(i+1).repeat(64))+',true)'));
 assert.equal(JSON.parse(sql("select set_config('request.jwt.claim.sub',"+quote(owner)+",false);select public.yesno_host_action("+quote(game.session_id)+",0,'lobby','start')")).ok,true);
 const queries=players.map((p,i)=>'begin;set local role anon;select public.yesno_submit('+quote(game.session_id)+','+quote(p.player_id)+','+quote(String(i+1).repeat(64))+',0,'+(i!==2)+',2);commit;');
 // All submissions and exact retries arrive on separate PostgreSQL connections.
 const results=await Promise.all([...queries,...queries].map(parallel));assert(results.every(x=>JSON.parse(x).ok));
 const result=JSON.parse(sql('select jsonb_build_object(\'phase\',s.phase,\'answers\',(select count(*) from private.yesno_answers where session_id=s.id),\'points\',(select sum(points) from private.yesno_answers where session_id=s.id)) from private.yesno_sessions s where id='+quote(game.session_id)));
 assert.deepEqual(result,{phase:'finished',answers:3,points:9});console.log('PASS: concurrent Ja/Nein submissions and retries settle once without duplicate scores');
})().catch(e=>{console.error(e);process.exitCode=1;});
