// Run after closer-db.sql in an isolated database, never against a live project.
const {execFileSync,spawn}=require('node:child_process'),assert=require('node:assert/strict');
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'",owner='33333333-3333-4333-8333-333333333333';
const sql=q=>execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1);
function parallel(q){return new Promise((resolve,reject)=>{const p=spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(JSON.parse(out.trim().split('\n').filter(Boolean).at(-1))));});}
(async()=>{
 sql('insert into auth.users values('+lit(owner)+') on conflict do nothing');
 const game=JSON.parse(sql("select set_config('request.jwt.claim.sub',"+lit(owner)+",false);select public.closer_create(1,null)"));
 const players=['Ada','Ben','Cleo'].map((name,i)=>JSON.parse(sql('select public.closer_join('+lit(game.join_code)+','+lit(name)+','+lit(String(i+1).repeat(64))+')')));
 const action=(phase,a)=>"select set_config('request.jwt.claim.sub',"+lit(owner)+",false);select public.closer_host_action("+lit(game.session_id)+",0,"+lit(phase)+','+lit(a)+')';
 assert.equal(JSON.parse(sql(action('lobby','start'))).ok,true);
 // Every player sends the same guess twice at the same time (double tap, network retry).
 const queries=players.map((p,i)=>'begin;set local role anon;select public.closer_guess('+lit(game.session_id)+','+lit(p.player_id)+','+lit(String(i+1).repeat(64))+',0,'+lit(String(10*(i+1)))+');commit;');
 const guesses=await Promise.all([...queries,...queries].map(parallel));assert(guesses.every(g=>g.ok));
 const reveals=await Promise.all([parallel(action('guess','reveal')),parallel(action('guess','reveal'))]);
 assert.equal(reveals.filter(r=>r.ok).length,1);assert.equal(reveals.filter(r=>r.error==='PHASE_CHANGED').length,1);
 // Three guesses on three different places: 3 + 2 + 1 points, awarded exactly once.
 assert.deepEqual(JSON.parse(sql('select jsonb_build_object(\'guesses\',(select count(*) from private.closer_guesses where session_id='+lit(game.session_id)+'),\'points\',(select sum(score) from private.closer_players where session_id='+lit(game.session_id)+'))')),{guesses:3,points:6});
 console.log('PASS: concurrent guesses/retries and simultaneous reveals never duplicate guesses or points');
})().catch(e=>{console.error(e);process.exitCode=1;});
