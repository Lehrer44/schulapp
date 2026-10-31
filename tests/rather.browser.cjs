// Test-only RPC bridge to actual PostgreSQL. No live project or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const teacher='11111111-1111-4111-8111-111111111111',lit=s=>"'"+String(s).replace(/'/g,"''")+"'";
const signatures={rather_question_list:[],rather_question_save:['p_id','p_question'],rather_question_delete:['p_id'],rather_quiz_list:[],rather_quiz_save:['p_id','p_name','p_question_ids'],rather_quiz_delete:['p_id'],rather_quiz_start:['p_id'],rather_create:['p_round_count','p_question_ids'],rather_join:['p_code','p_name','p_token'],rather_reveal_result:['p_session_id','p_round','p_target_id'],rather_host_state:['p_session_id'],rather_player_state:['p_session_id','p_player_id','p_token'],rather_host_action:['p_session_id','p_round','p_phase','p_action'],rather_vote:['p_session_id','p_player_id','p_token','p_round','p_target_id'],classroom_resolve_code:['p_join_code','p_kind_hint']};
const participant=new Set(['rather_join','rather_player_state','rather_vote','classroom_resolve_code']);
function value(v){if(v==null)return 'null';if(Array.isArray(v))return 'array['+v.map(Number).join(',')+']::bigint[]';return typeof v==='number'?String(v):lit(v);}
let db,serial=Promise.resolve();
function sql(query){if(db)return db.exec(query);return Promise.resolve(execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1));}
async function rpc(name,args,host){
 if(!signatures[name]){if(['bluff_quiz_list','yesno_game_list','same_quiz_list'].includes(name))return {ok:true,quizzes:[],games:[],sessions:[]};throw Error('Unknown RPC '+name);}
 if(!host&&!participant.has(name))throw Error('RPC denied');
 const query='begin;'+(host?"select set_config('request.jwt.claim.sub',"+lit(teacher)+",true);set local role authenticated;":'set local role anon;')+'select public.'+name+'('+signatures[name].map(k=>k+'=>'+value(args[k])).join(',')+');commit;';
 if(db){const results=await sql(query);return Object.values(results.filter(r=>r.rows.length).at(-1).rows[0])[0];}
 return JSON.parse(await sql(query));
}
function load(file){return fs.readFileSync(file,'utf8').replace(/^\\set.*$/mg,'').replace(/^\\ir (.*)$/mg,(_,f)=>load(path.resolve(path.dirname(file),f.trim())));}
(async()=>{
 if(process.env.RATHER_PGLITE){const {PGlite}=require(process.env.RATHER_PGLITE);db=new PGlite();await db.exec(load(path.join(root,'tests/rather-db.sql')));}
 await sql('insert into auth.users(id) values('+lit(teacher)+') on conflict do nothing');
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/rpc'){let raw='';for await(const c of req)raw+=c;const {name,args={},host}=JSON.parse(raw);const task=serial.then(()=>rpc(name,args,host));serial=task.catch(()=>{});try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:await task}));}catch(e){console.error(name,e);res.end(JSON.stringify({error:{message:e.message}}));}return;}
  const url=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+url);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({args:['--no-sandbox'],...(process.env.RATHER_BROWSER?{executablePath:process.env.RATHER_BROWSER}:{})}),contexts=[],errors=[];
 async function page(host,viewport){const c=await browser.newContext({viewport});contexts.push(c);await c.addInitScript(host=>{
  window.__payloads=[];window.supabase={createClient:()=>({from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{revision:1,payload:{quizzes:[{id:'classic',title:'Klassisches Quiz',questions:[]}]}}}}};return q;},auth:{async getUser(){return {data:{user:host?{id:'11111111-1111-4111-8111-111111111111'}:null}}}},async rpc(name,args){if(window.__failSync&&name.startsWith('rather_'))return {error:{message:'Test offline'}};const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,host})});const payload=await r.json();window.__payloads.push({name,payload});return payload;},channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c;}};return c;},removeChannel(){}})};
 },host);await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());return p;}
 const shot=async(p,name)=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+name);await p.screenshot({path:path.join(output,'rather-'+name+'.png'),fullPage:true});};
 try{
  const host=await page(true,{width:1280,height:900});await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('#ratherLibrary .empty').waitFor();
  await host.locator('#ratherLibrary a').click();await host.locator('[data-action="edit-question"]').first().waitFor();assert.equal(await host.locator('[data-action="edit-question"]').count(),10);
  await host.locator('[data-action="edit-question"]').first().click();await host.locator('#questionText').fill('Wer würde eher eine Rakete bauen?');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Wer würde eher eine Rakete bauen?',{exact:true}).waitFor();
  await host.locator('[data-action="new-question"]').click();await host.locator('#questionText').fill('Wer würde eher den Test gewinnen?');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Wer würde eher den Test gewinnen?',{exact:true}).waitFor();
  await shot(host,'catalog-desktop');
  await host.locator('.app-nav a[href="../index.html"]').click();await host.locator('#ratherLibrary .empty').waitFor();
  await host.locator('[data-rather-action="new"]').click();await host.locator('#ratherQuizName').fill('Unsere Runde');await host.locator('.bluff-question-choice input').nth(0).check();await host.locator('.bluff-question-choice input').nth(1).check();await host.locator('#ratherQuizForm [type="submit"]').click();await host.getByText('Unsere Runde',{exact:true}).waitFor();
  await host.locator('[data-rather-action="edit"]').click();await host.locator('#ratherQuizName').waitFor();assert.equal(await host.locator('.bluff-question-choice input:checked').count(),2);await host.locator('#ratherQuizName').fill('Klassenrunde');await host.locator('#ratherQuizForm [type="submit"]').click();await host.getByText('Klassenrunde',{exact:true}).waitFor();
  await host.setViewportSize({width:390,height:844});await shot(host,'studio-mobile');
  await host.locator('[data-rather-action="random"]').click();await host.locator('#ratherRoundCount').fill('1');await host.locator('#ratherQuizForm [type="submit"]').click();await host.waitForURL('**/rather/live.html?session=*');await host.locator('.bluff-start-card').waitFor();assert(await host.locator('.bluff-start-card').isDisabled());await shot(host,'lobby-mobile');
  await host.locator('[data-action="end"]').click();await host.getByText('Endplatzierung',{exact:true}).waitFor();await host.getByRole('link',{name:'Quiz Studio',exact:true}).last().click();
  await host.locator('[data-rather-action="start"]').click();await host.waitForURL('**/rather/live.html?session=*');await host.locator('[data-action="participation"]').click();await host.locator('.bluff-qr img').waitFor();
  const qr=await host.locator('.bluff-qr canvas').evaluate(c=>({w:c.width,h:c.height,data:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}));const decoded=require('jsqr')(new Uint8ClampedArray(qr.data),qr.w,qr.h);assert(decoded);const join=new URL(decoded.data);assert.equal(join.searchParams.get('kind'),'rather');const code=join.searchParams.get('code');await host.keyboard.press('Escape');
  const players=[];
  for(const name of ['Ada','Ben','Cleo']){const p=await page(false,{width:390,height:844});players.push(p);await p.goto(join.href);await p.waitForURL('**/rather/student.html?code=*');await p.locator('#playerName').fill(name);await p.locator('#joinForm [type="submit"]').click();await p.getByText('Wartelobby',{exact:true}).waitFor();assert.equal(await p.locator('.app-nav').count(),0);}
  await host.setViewportSize({width:1280,height:900});await host.locator('.bluff-score').filter({hasText:'Cleo'}).waitFor();await shot(host,'lobby-desktop');await shot(players[0],'waiting-mobile');
  await host.locator('[data-action="start"]').click();for(const p of players)await p.locator('.rather-choices button').first().waitFor();
  const ids=await players[0].locator('.rather-choices button').evaluateAll(bs=>Object.fromEntries(bs.map(b=>[b.querySelector('.rather-name').textContent,b.dataset.id])));
  await players[0].locator('[data-action="vote"][data-id="'+ids.Ada+'"]').click();await players[0].getByText('✓ Deine Stimme ist verbindlich gespeichert.',{exact:true}).waitFor();await players[0].reload();await players[0].getByText('✓ Deine Stimme ist verbindlich gespeichert.',{exact:true}).waitFor();
  await players[1].locator('[data-action="vote"][data-id="'+ids.Ada+'"]').click();await players[2].locator('[data-action="vote"][data-id="'+ids.Ben+'"]').click();
  await host.waitForFunction(()=>window.__payloads.some(x=>x.name==='rather_host_state'&&x.payload.data?.phase==='vote'&&x.payload.data.players.every(p=>p.voted)));
  for(const p of [host,...players]){assert.equal(await p.getByText(/\d+ von \d+ haben abgestimmt/).count(),0);assert.equal(await p.locator('.rather-choices .bluff-avatar,.rather-choices .bluff-person').count(),0);}
  assert.equal(await host.locator('[data-action="show_bars"]').innerText(),'Auswerten');
  assert.equal(await host.locator('[data-action="show_bars"]').evaluate(b=>getComputedStyle(b).backgroundColor),'rgb(255, 255, 255)');await shot(players[0],'vote-mobile');await shot(host,'vote-desktop');
  await host.locator('[data-action="show_bars"]').click();await host.locator('.rather-result').first().waitFor();assert.equal(await host.locator('.rather-count,.rather-voters').count(),0);
  assert.equal(await host.locator('.rather-results').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);await shot(host,'results-hidden-desktop');
  await players[2].locator('.rather-result').first().waitFor();assert.equal(await players[2].locator('[data-action="reveal-result"]').count(),0);
  assert(await players[2].evaluate(()=>window.__payloads.filter(x=>x.name==='rather_player_state'&&x.payload.data?.phase==='bars').every(x=>x.payload.data.results.every(r=>r.count===null&&!('voters' in r)))));
  const ada='[data-target-id="'+ids.Ada+'"]',ben='[data-target-id="'+ids.Ben+'"]',cleo='[data-target-id="'+ids.Cleo+'"]';
  await host.locator(ada+' button').focus();await host.keyboard.press('Enter');await host.locator(ada+' [role="meter"]').waitFor();assert.equal(await host.locator(ada+' .rather-count').innerText(),'2 Stimmen');
  assert.equal(await host.locator(ben+' .rather-count').count(),0);assert.equal(await host.locator('.rather-voters').count(),0);
  await players[0].locator(ada+' .rather-count').waitFor();assert.equal(await players[0].locator(ada+' .rather-count').innerText(),'2 Stimmen');assert.equal(await players[0].locator(ben+' .rather-count').count(),0);
  await host.reload();await host.locator(ada+' [role="meter"]').waitFor();assert.equal(await host.locator(ada+' [role="meter"]').getAttribute('aria-valuenow'),'2');assert.equal(await host.locator(ben+' .rather-count').count(),0);await shot(host,'results-partial-desktop');
  await host.setViewportSize({width:390,height:844});await shot(host,'results-partial-mobile');await host.setViewportSize({width:1280,height:900});
  await host.locator(ben+' button').click();await host.locator(cleo+' button').click();await host.locator(cleo+' .rather-count').waitFor();assert.equal(await host.locator(cleo+' .rather-count').innerText(),'0 Stimmen');
  await host.locator('[data-action="reveal"]').click();await host.locator(ada+' .rather-voter').first().waitFor();assert.equal(await host.locator(ada+' .rather-voter').count(),2);
  for(const p of [host,...players]){await p.locator('.rather-voter').first().waitFor();assert.equal(await p.getByText('Gewählt von',{exact:true}).count(),0);assert.equal(await p.getByText('Keine Stimmen',{exact:true}).count(),0);assert.equal(await p.locator('.rather-result .bluff-person,.rather-result .bluff-avatar,.rather-result .rather-count').count(),0);assert.equal(await p.locator(ada+' > .rather-result-row > .rather-voters .rather-voter').count(),2);assert.equal(await p.locator('.rather-result > .rather-voters').count(),0);assert(await p.locator(ada).evaluate(el=>{const name=el.querySelector('.rather-name').getBoundingClientRect(),voters=el.querySelector('.rather-voters').getBoundingClientRect();return voters.left>=name.right&&voters.top<name.bottom&&voters.bottom>name.top;}));}
  assert.equal(await host.locator('[data-action="scores"]').count(),0);await shot(host,'reveal-desktop');await shot(players[0],'reveal-mobile');
  assert.equal(await host.locator('.bluff-score[data-player-id="'+ids.Ada+'"] b').innerText(),'1 P');assert.equal(await host.locator('.bluff-score[data-player-id="'+ids.Cleo+'"] b').innerText(),'0 P');
  await host.locator('[data-action="next"]').click();await players[0].locator('.rather-choices button').first().waitFor();await players[2].locator('.rather-choices button').first().waitFor();
  await players[0].locator('[data-action="vote"][data-id="'+ids.Ada+'"]').click();await players[2].locator('[data-action="vote"][data-id="'+ids.Cleo+'"]').click();
  await host.waitForFunction(()=>window.__payloads.some(x=>x.name==='rather_host_state'&&x.payload.data?.round_index===1&&x.payload.data.players.filter(p=>p.voted).length===2));
  await host.locator('[data-action="show_bars"]').click();await host.locator('[data-action="reveal"]').waitFor();assert.equal(await host.locator('.rather-count').count(),0);
  await host.locator('[data-action="reveal"]').click();await host.locator('[data-action="next"]').click();await host.getByText('Endplatzierung',{exact:true}).waitFor();
  assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score b').allTextContents(),['2 P','1 P','1 P']);assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score>span').allTextContents(),['1','2','2']);await shot(host,'final-desktop');
  await players[0].getByText('Endplatzierung',{exact:true}).waitFor();await shot(players[0],'final-mobile');
  assert.deepEqual(errors,[]);console.log('PASS: catalogue, saved/random games, decoded QR entry, mobile lobby, self-votes, reload, hidden voters, bars, reveal, majority/ties and final placement');
 }catch(e){for(const c of contexts)for(const p of c.pages()){console.error('Page:',p.url(),await p.locator('#appMessage,[data-rather-status],#cloudStatus').allTextContents());await p.screenshot({path:path.join(output,'rather-failure-'+contexts.indexOf(c)+'.png'),fullPage:true}).catch(()=>{});}throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(db)await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
