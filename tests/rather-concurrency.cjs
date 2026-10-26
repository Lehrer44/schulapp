// Run after rather-db.sql in an isolated database, never against a live project.
const {execFileSync,spawn}=require('node:child_process'),assert=require('node:assert/strict');
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'",owner='22222222-2222-4222-8222-222222222222';
const sql=q=>execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1);
function parallel(q){return new Promise((resolve,reject)=>{const p=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out.trim().split('\n').filter(Boolean).at(-1))));});}
(async()=>{
 sql('insert into auth.users values('+lit(owner)+') on conflict do nothing');
 const game=JSON.parse(sql("select set_config('request.jwt.claim.sub',"+lit(owner)+",false);select public.rather_create(1,null)"));
 const players=['Ada','Ben','Cleo'].map((name,i)=>JSON.parse(sql('select public.rather_join('+lit(game.join_code)+','+lit(name)+','+lit(String(i+1).repeat(64))+')')));
 const action=(phase,a)=>"select set_config('request.jwt.claim.sub',"+lit(owner)+",false);select public.rather_host_action("+lit(game.session_id)+",0,"+lit(phase)+','+lit(a)+')';
 assert.equal(JSON.parse(sql(action('lobby','start'))).ok,true);
 const queries=players.map((p,i)=>'begin;set local role anon;select public.rather_vote('+lit(game.session_id)+','+lit(p.player_id)+','+lit(String(i+1).repeat(64))+',0,'+lit(players[0].player_id)+');commit;');
 const votes=await Promise.all([...queries,...queries].map(parallel));assert(votes.every(v=>v.ok));
 assert.equal(JSON.parse(sql(action('vote','show_bars'))).ok,true);
 const reveals=await Promise.all([parallel(action('bars','reveal')),parallel(action('bars','reveal'))]);
 assert.equal(reveals.filter(v=>v.ok).length,1);assert.equal(reveals.filter(v=>v.error==='PHASE_CHANGED').length,1);
 assert.deepEqual(JSON.parse(sql('select jsonb_build_object(\'votes\',(select count(*) from private.rather_votes where session_id='+lit(game.session_id)+'),\'points\',(select sum(score) from private.rather_players where session_id='+lit(game.session_id)+'))')),{votes:3,points:3});
 console.log('PASS: concurrent votes/retries and simultaneous reveals never duplicate votes or points');
})().catch(e=>{console.error(e);process.exitCode=1;});
