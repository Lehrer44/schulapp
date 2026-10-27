// Test-only RPC bridge to actual PostgreSQL. No live project or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const teacher='11111111-1111-4111-8111-111111111111',lit=s=>"'"+String(s).replace(/'/g,"''")+"'";
const signatures={same_question_list:[],same_question_save:['p_id','p_question','p_kind'],same_question_delete:['p_id'],same_quiz_list:[],same_quiz_save:['p_id','p_name','p_question_ids'],same_quiz_delete:['p_id'],same_quiz_start:['p_id'],same_create:['p_round_count','p_question_ids'],same_join:['p_code','p_name','p_token'],same_host_state:['p_session_id'],same_player_state:['p_session_id','p_player_id','p_token'],same_host_action:['p_session_id','p_round','p_phase','p_action'],same_answer:['p_session_id','p_player_id','p_token','p_round','p_answer'],same_manage:['p_session_id','p_round','p_phase','p_action','p_target','p_team','p_value'],classroom_resolve_code:['p_join_code','p_kind_hint']};
const participant=new Set(['same_join','same_player_state','same_answer','classroom_resolve_code']);
function value(v){if(v==null)return 'null';if(Array.isArray(v))return 'array['+v.map(Number).join(',')+']::bigint[]';return typeof v==='number'?String(v):lit(v);}
let db,serial=Promise.resolve();
function sql(query){if(db)return db.exec(query);return Promise.resolve(execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1));}
async function rpc(name,args,host){
 if(!signatures[name]){if(['bluff_quiz_list','rather_quiz_list','yesno_game_list'].includes(name))return {ok:true,quizzes:[],games:[],sessions:[]};throw Error('Unknown RPC '+name);}
 if(!host&&!participant.has(name))throw Error('RPC denied');
 const query='begin;'+(host?"select set_config('request.jwt.claim.sub',"+lit(teacher)+",true);set local role authenticated;":'set local role anon;')+'select public.'+name+'('+signatures[name].map(k=>k+'=>'+(k==='p_value'?lit(JSON.stringify(args[k]??null))+'::jsonb':value(args[k]))).join(',')+');commit;';
 if(db){const results=await sql(query);return Object.values(results.filter(r=>r.rows.length).at(-1).rows[0])[0];}
 return JSON.parse(await sql(query));
}
function load(file){return fs.readFileSync(file,'utf8').replace(/^\\set.*$/mg,'').replace(/^\\ir (.*)$/mg,(_,f)=>load(path.resolve(path.dirname(file),f.trim())));}
(async()=>{
 if(process.env.SAME_PGLITE){const {PGlite}=require(process.env.SAME_PGLITE);db=new PGlite();await db.exec(load(path.join(root,'tests/same-db.sql')));}
 await sql('insert into auth.users(id) values('+lit(teacher)+') on conflict do nothing');
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/rpc'){let raw='';for await(const c of req)raw+=c;const {name,args={},host}=JSON.parse(raw);const task=serial.then(()=>rpc(name,args,host));serial=task.catch(()=>{});try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:await task}));}catch(e){console.error(name,e);res.end(JSON.stringify({error:{message:e.message}}));}return;}
  const url=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+url);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({args:['--no-sandbox'],...(process.env.SAME_BROWSER?{executablePath:process.env.SAME_BROWSER}:{})}),contexts=[],errors=[];
 async function page(host,viewport){const c=await browser.newContext({viewport});contexts.push(c);await c.addInitScript(host=>{
  window.__payloads=[];window.supabase={createClient:()=>({from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{revision:1,payload:{quizzes:[{id:'classic',title:'Klassisches Quiz',questions:[]}]}}}}};return q;},auth:{async getUser(){return {data:{user:host?{id:'11111111-1111-4111-8111-111111111111'}:null}}}},async rpc(name,args){if(window.__failSync&&name.startsWith('same_'))return {error:{message:'Test offline'}};const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,host})});const payload=await r.json();window.__payloads.push({name,payload});return payload;},channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c;}};return c;},removeChannel(){}})};
 },host);await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept(d.type()==='prompt'?(d.message().startsWith('Rundenpunkte')?'3':'Lila'):undefined));return p;}
 const shot=async(p,name)=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+name);await p.screenshot({path:path.join(output,'same-'+name+'.png'),fullPage:true});};
 try{
  const host=await page(true,{width:1280,height:900});await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('#sameLibrary .empty').waitFor();
  await host.locator('#sameLibrary a').click();await host.locator('[data-action="edit-question"]').first().waitFor();assert.equal(await host.locator('[data-action="edit-question"]').count(),10);
  await host.locator('[data-action="edit-question"]').first().click();await host.locator('#questionText').fill('Nenne eine Farbe.');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Nenne eine Farbe.',{exact:true}).waitFor();
  await host.locator('[data-action="new-question"]').click();await host.locator('#questionText').fill('Wer von euch fährt am liebsten Rad?');await host.locator('#questionKind').selectOption('team');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Wer von euch fährt am liebsten Rad?',{exact:true}).waitFor();await shot(host,'catalog-desktop');
  await host.locator('.app-nav a[href="../index.html"]').click();await host.locator('#sameLibrary .empty').waitFor();
  await host.locator('[data-same-action="new"]').click();await host.locator('#sameQuizName').fill('Teamrunde');await host.locator('.bluff-question-choice input').nth(0).check();await host.locator('.bluff-question-choice input').nth(6).check();await host.locator('#sameQuizForm [type="submit"]').click();await host.getByText('Teamrunde',{exact:true}).waitFor();
  await host.locator('[data-same-action="edit"]').click();await host.locator('#sameQuizName').waitFor();assert.equal(await host.locator('.bluff-question-choice input:checked').count(),2);await host.locator('[data-cancel]').click();
  await host.setViewportSize({width:390,height:844});await shot(host,'studio-mobile');
  await host.locator('[data-same-action="start"]').click();await host.waitForURL('**/same/live.html?session=*');const sid=new URL(host.url()).searchParams.get('session');
  await host.locator('[data-action="participation"]').click();await host.locator('.bluff-qr img').waitFor();
  const qrUrl=await host.locator('[data-join-link]').getAttribute('href');assert(qrUrl.includes('kind=same'));await host.locator('[data-close]').click();
  const names=['Ada','Ben','Cleo','Dora','Emil','Finn'],players=[],ids=[];
  for(const name of names){const p=await page(false,{width:390,height:844});await p.goto(qrUrl);await p.waitForURL('**/same/student.html?code=*');await p.locator('#playerName').fill(name);await p.locator('#joinForm [type="submit"]').click();await p.getByText('Wartelobby',{exact:true}).waitFor();players.push(p);}
  await host.locator('[data-assign]').nth(5).waitFor();
  for(const name of names){const row=host.locator('.same-person').filter({has:host.getByText(name,{exact:true})});const select=row.locator('[data-assign]');ids.push(await select.getAttribute('data-assign'));await select.selectOption(names.indexOf(name)<3?'1':'2');await host.waitForFunction(({id,team})=>document.querySelector('[data-assign="'+id+'"]')?.value===team,{id:ids.at(-1),team:names.indexOf(name)<3?'1':'2'});}
  await host.locator('#timerSeconds').fill('120');await host.locator('#settingsForm [type="submit"]').click();await host.waitForFunction(()=>document.getElementById('timerSeconds').value==='120');
  await host.setViewportSize({width:1280,height:900});await host.evaluate(()=>scrollTo(0,0));await shot(host,'lobby-desktop');await shot(players[0],'lobby-mobile');
  await host.locator('[data-action="start"]').click();await players[0].locator('#answerText').waitFor();
  await players[0].locator('#answerText').fill(' ROT ');
  await players[1].locator('#answerText').fill('rot');await players[1].locator('#answerForm button').click();await players[1].getByText('✓ Deine Antwort ist gespeichert.',{exact:true}).waitFor();
  await players[0].getByText('1 von 6 haben geantwortet.',{exact:true}).waitFor();assert.equal(await players[0].locator('#answerText').inputValue(),' ROT ');assert.equal(await players[0].locator('.same-answer').count(),0);
  await players[0].locator('#answerForm button').click();await players[0].getByText('✓ Deine Antwort ist gespeichert.',{exact:true}).waitFor();await players[0].reload();await players[0].getByText('✓ Deine Antwort ist gespeichert.',{exact:true}).waitFor();
  for(const [i,answer] of [[2,'Rot'],[3,'Blau'],[4,'blau'],[5,'Grün']]){await players[i].locator('#answerText').fill(answer);await players[i].locator('#answerForm button').click();}
  await host.locator('[data-action="reveal"]').first().waitFor();assert.equal(await host.locator('.same-answer').count(),0);
  await host.locator('[data-action="reveal"]').first().click();await host.locator('.same-answer').first().waitFor();assert.equal(await host.locator('.same-answer').count(),1);
  await players[1].locator('.same-answer').first().waitFor();assert(await players[1].evaluate(()=>window.__payloads.filter(x=>x.name==='same_player_state'&&x.payload.data?.phase==='answers').every(x=>x.payload.data.players.every(p=>!('answer' in p)))));
  for(let i=1;i<6;i++){await host.locator('[data-action="reveal"]').first().click();await host.waitForFunction(n=>document.querySelectorAll('.same-answer').length===n,i+1);}
  await host.locator('[data-action="correct"]').last().click();await host.getByText('Lila',{exact:true}).waitFor();await shot(host,'reveal-desktop');await players[0].locator('.same-answer').nth(5).waitFor();await shot(players[0],'reveal-mobile');
  await host.locator('[data-action="scores"]').click();await host.getByText('Team 1 · 3 Punkte',{exact:true}).waitFor();await host.getByText('Team 2 · 1 Punkte',{exact:true}).waitFor();
  await host.locator('[data-action="override"][data-team="2"]').click();await host.getByText('Team 2 · 3 Punkte',{exact:true}).waitFor();
  await host.locator('[data-action="next"]').click();await players[0].locator('select#answerText').waitFor();assert.deepEqual(await players[0].locator('#answerText option').allTextContents(),['Name aus deinem Team wählen','Ada','Ben','Cleo']);
  await players[0].locator('#answerText').selectOption('Ada');await players[0].locator('#answerForm button').click();await host.getByText('1 von 6 haben geantwortet.',{exact:true}).waitFor();await host.locator('[data-action="close"]').click();await host.locator('[data-action="reveal"]').click();await host.locator('.same-answer').waitFor();await host.locator('[data-action="scores"]').click();await host.getByText('Team 1 · 0 Punkte',{exact:true}).waitFor();await host.locator('[data-action="next"]').click();
  await host.getByText('Endplatzierung',{exact:true}).waitFor();assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score b').allTextContents(),['3 P','3 P']);assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score>span').allTextContents(),['1','1']);await shot(host,'final-desktop');await players[0].getByText('Endplatzierung',{exact:true}).waitFor();await shot(players[0],'final-mobile');
  // Random creation remains available alongside named games.
  await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('[data-same-action="random"]').click();await host.locator('#sameRoundCount').fill('1');await host.locator('#sameQuizForm [type="submit"]').click();await host.waitForURL('**/same/live.html?session=*');
  assert.deepEqual(errors,[]);console.log('PASS: same catalogue/types, saved/random games, QR entry, 6 mobile players, team setup, draft retention, secret answers, individual reveal, correction, override, team-only names and tied placement');
 }catch(e){for(const c of contexts)for(const p of c.pages()){console.error('Page:',p.url(),await p.locator('#appMessage,[data-same-status],#cloudStatus').allTextContents());await p.screenshot({path:path.join(output,'same-failure-'+contexts.indexOf(c)+'.png'),fullPage:true}).catch(()=>{});}throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(db)await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

