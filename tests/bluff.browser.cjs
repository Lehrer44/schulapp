// Real PostgreSQL RPCs behind a local test-only HTTP bridge; no live accounts or service keys.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const teacher='11111111-1111-4111-8111-111111111111',sqlLiteral=s=>"'"+String(s).replace(/'/g,"''")+"'";
function sql(query){return execFileSync('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',env:process.env}).trim().split('\n').filter(Boolean).at(-1);}
const signatures={bluff_quiz_list:[],bluff_quiz_save:['p_id','p_name','p_question_ids'],bluff_quiz_delete:['p_id'],bluff_quiz_start:['p_id'],bluff_question_list:[],bluff_owned_sessions:[],bluff_question_save:['p_id','p_question','p_correct_answer','p_category','p_source_url'],bluff_question_delete:['p_id'],bluff_create:['p_round_count','p_question_ids'],bluff_host_state:['p_session_id'],bluff_host_action:['p_session_id','p_round','p_phase','p_action','p_seconds','p_reveal_count'],bluff_join:['p_code','p_name','p_token'],bluff_player_state:['p_session_id','p_player_id','p_token'],bluff_submit:['p_session_id','p_player_id','p_token','p_round','p_answer'],bluff_vote:['p_session_id','p_player_id','p_token','p_round','p_option_id'],classroom_resolve_code:['p_join_code','p_kind_hint']};
function value(v){if(v===null||v===undefined)return 'null';if(Array.isArray(v))return 'array['+v.map(x=>Number(x)).join(',')+']::bigint[]';if(typeof v==='number')return String(v);return sqlLiteral(v);}
const hostNames=new Set(['bluff_quiz_list','bluff_quiz_save','bluff_quiz_delete','bluff_quiz_start','bluff_question_list','bluff_question_save','bluff_question_delete','bluff_owned_sessions','bluff_create','bluff_host_state','bluff_host_action']);
sql('insert into auth.users(id) values('+sqlLiteral(teacher)+') on conflict do nothing');
const calls=[];
const server=http.createServer();
// JSON extraction is intentionally separate from the application; only this test bridge can query PostgreSQL.
function queryRpc(name,args,host){const expression='public.'+name+'('+signatures[name].map(k=>k+'=>'+value(args[k])).join(',')+')';const out=execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c','begin;'+(host?"select set_config('request.jwt.claim.sub',"+sqlLiteral(teacher)+",true);set local role authenticated;":'set local role anon;')+'select '+expression+';commit;'],{encoding:'utf8',env:process.env}).trim().split('\n').filter(Boolean);return JSON.parse(out.at(-1));}
// One SQL execution per test RPC.
server.on('request',async(req,res)=>{
 if(req.url==='/rpc'){let raw='';for await(const chunk of req)raw+=chunk;const {name,args={},host}=JSON.parse(raw);calls.push({name,args,host});try{if(!signatures[name]||hostNames.has(name)&&!host)throw Error('RPC denied');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:queryRpc(name,args,host)}));}catch(e){res.end(JSON.stringify({error:{message:e.message}}));}return;}
 const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';const browser=await chromium.launch({args:['--no-sandbox']});const contexts=[],errors=[];
 async function context(host,viewport){const c=await browser.newContext({viewport});contexts.push(c);await c.addInitScript(isHost=>{window.__host=isHost;window.__payloads=[];window.supabase={createClient:()=>({from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{revision:1,payload:{quizzes:[{id:'classic',title:'Klassisches Quiz',questions:[]}]}}}}};return q},auth:{async getUser(){return {data:{user:isHost?{id:'11111111-1111-4111-8111-111111111111'}:null}}}},async rpc(name,args){if(window.__failSync&&['bluff_host_state','bluff_player_state','bluff_question_list'].includes(name))return {error:{message:'Testverbindung unterbrochen'}};const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,host:isHost})});const data=await r.json();window.__payloads.push({name,data});return data;},channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c}};return c},removeChannel(){}})};},host);await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));return c;}
 try{
 const hc=await context(true,{width:1280,height:900}),host=await hc.newPage();host.on('pageerror',e=>errors.push(e.message));host.on('dialog',d=>d.accept());
 await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('#bluffLibrary .empty').waitFor();
 assert(await host.locator('#classicLibrary').evaluate(el=>el.nextElementSibling.id==='bluffLibrary'));
 assert.equal(await host.locator('.studio-header button').count(),0);
 assert.equal(await host.locator('#classicLibrary [data-action="import"]').count(),0);
 assert.equal(await host.locator('#classicLibrary [data-action="export-all"]').count(),0);
 assert.equal(await host.locator('#classicLibrary [data-action="new-quiz"]').count(),1);
 assert.deepEqual(await host.locator('#classicLibrary,#bluffLibrary').evaluateAll(els=>els.map(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).borderRadius])),[['rgb(255, 255, 255)','8px'],['rgb(255, 255, 255)','8px']]);
 await host.locator('#bluffLibrary a').click();await host.waitForURL('**/bluff/index.html');
 assert.equal(await host.locator('#gameForm,#category,#sourceUrl,.bluff-banner').count(),0);
 assert.equal(await host.locator('[data-action="edit-question"]').count(),10);
 await host.locator('[data-question-id="1"] [data-action="edit-question"]').click();await host.locator('#questionText').fill('Meine persönliche Startfrage im Browsertest?');await host.locator('#correctAnswer').fill('Persönliche Lösung');assert.equal(await host.locator('#correctAnswer').inputValue(),'PERSÖNLICHE LÖSUNG');await host.locator('#questionForm button[type="submit"]').click();await host.locator('#questionRows').getByText('Meine persönliche Startfrage im Browsertest?',{exact:true}).waitFor();
 const personal=JSON.parse(sql("select json_agg(id) from private.bluff_questions where owner_id="+sqlLiteral(teacher))).at(-1);
 await host.locator('[data-question-id="'+personal+'"] [data-action="delete-question"]').click();await host.locator('[data-question-id="'+personal+'"]').waitFor({state:'detached'});
 await host.locator('[data-action="new-question"]').click();await host.locator('#questionText').fill('Was ist die echte Browser-Testantwort?');await host.locator('#correctAnswer').fill('Die geheime Wahrheit');await host.locator('#questionForm button[type="submit"]').click();await host.locator('#questionRows').getByText('Was ist die echte Browser-Testantwort?',{exact:true}).waitFor();
 const qid=JSON.parse(sql("select json_agg(id) from private.bluff_questions where owner_id="+sqlLiteral(teacher))).at(-1);
 await host.screenshot({path:path.join(output,'bluff-collection-desktop.png'),fullPage:true});
 await host.locator('.app-nav a[href="../index.html"]').click();await host.waitForURL('**/quiz-studio/index.html');await host.locator('#bluffLibrary .empty').waitFor();
 await host.locator('[data-bluff-action="new"]').click();await host.locator('#bluffQuizName').fill('Kurioses zum Bluffen');
 await host.locator('.bluff-question-choice input[value="'+qid+'"]').check();await host.locator('.bluff-question-choice input[value="2"]').check();await host.locator('#bluffQuizForm [type="submit"]').click();
 await host.locator('[data-bluff-quiz-id] h3').getByText('Kurioses zum Bluffen',{exact:true}).waitFor();
 await host.reload();await host.locator('[data-bluff-action="edit"]').click();await host.locator('#bluffQuizName').fill('Unser Bluff-Quiz');assert.equal(await host.locator('.bluff-question-choice input:checked').count(),2);await host.locator('#bluffQuizForm [type="submit"]').click();await host.getByText('Unser Bluff-Quiz',{exact:true}).waitFor();
 await host.locator('[data-bluff-action="new"]').click();await host.locator('#bluffQuizName').fill('Zum Löschen');await host.locator('.bluff-question-choice input').first().check();await host.locator('#bluffQuizForm [type="submit"]').click();await host.getByText('Zum Löschen',{exact:true}).waitFor();await host.locator('[data-bluff-quiz-id]').filter({hasText:'Zum Löschen'}).locator('[data-bluff-action="delete"]').click();await host.getByText('Zum Löschen',{exact:true}).waitFor({state:'detached'});
 await host.screenshot({path:path.join(output,'bluff-library-desktop.png'),fullPage:true});
 await host.setViewportSize({width:390,height:844});assert(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await host.screenshot({path:path.join(output,'bluff-library-mobile.png'),fullPage:true});
 await host.locator('[data-bluff-action="random"]').click();await host.locator('#bluffRoundCount').fill('3');await host.locator('#bluffQuizForm [type="submit"]').click();await host.waitForURL('**/bluff/live.html?session=*');
 assert.equal(await host.locator('.studio-actions [data-action="start"],.studio-actions a[href="../index.html"],#connectionStatus').count(),0);
 assert.equal(await host.locator('.bluff-subtitle').count(),0);
 assert.equal(await host.locator('.bluff-start-card[data-action="start"]').count(),1);
 assert(await host.locator('.bluff-start-card').isDisabled());
 assert.equal(await host.locator('.ranking-panel h2').innerText(),'Rangliste');
 assert.equal(await host.locator('.ranking-panel .bluff-empty').innerText(),'noch keine Teilnehmer');
 await host.evaluate(()=>window.__failSync=true);
 await host.waitForFunction(()=>document.querySelector('#bluffConnectionStatus').dataset.state==='error');
 assert.equal(await host.locator('#bluffConnectionStatus').evaluate(el=>getComputedStyle(el).color),'rgb(162, 54, 40)');
 await host.evaluate(()=>window.__failSync=false);
 await host.waitForFunction(()=>document.querySelector('#bluffConnectionStatus').dataset.state==='ready');
 const randomSid=new URL(host.url()).searchParams.get('session');assert.equal(sql('select count(distinct question) from private.bluff_rounds where session_id='+sqlLiteral(randomSid)),'3');
 await host.locator('[data-action="participation"]').click();await host.locator('#participationDialog[open] .bluff-qr img').waitFor();
 const qr=await host.locator('#participationDialog .bluff-qr canvas').evaluate(c=>({width:c.width,height:c.height,pixels:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}));const decoded=require('jsqr')(new Uint8ClampedArray(qr.pixels),qr.width,qr.height);assert(decoded);assert(new URL(decoded.data).pathname.endsWith('/join.html'));assert.equal(new URL(decoded.data).searchParams.get('kind'),'bluff');
 await host.screenshot({path:path.join(output,'bluff-participation-mobile.png'),fullPage:true});await host.keyboard.press('Escape');assert.equal(await host.locator('#participationDialog[open]').count(),0);
 await host.locator('[data-action="end"]').click();await host.waitForURL('**/quiz-studio/index.html');
 await host.setViewportSize({width:1280,height:900});await host.locator('[data-bluff-action="start"]').click();await host.waitForURL('**/bluff/live.html?session=*');const sid=new URL(host.url()).searchParams.get('session');await host.locator('[data-action="participation"]').waitFor();assert.equal(await host.locator('#app .bluff-code').count(),0);assert.equal(await host.getByText('Alle bereit für den Bluff?',{exact:true}).count(),0);await host.screenshot({path:path.join(output,'bluff-lobby-desktop.png'),fullPage:true});await host.locator('[data-action="participation"]').click();const code=await host.locator('.bluff-join-code').innerText();await host.keyboard.press('Escape');
 assert.equal(sql('select count(*) from private.bluff_rounds where session_id='+sqlLiteral(sid)),'2');

 async function checkBoard(phase){
  await host.locator('.live-sidebar .ranking-panel').waitFor();
  assert.deepEqual(await host.locator('.live-sidebar h2').allTextContents(),['Rangliste']);
  assert.equal(await host.getByRole('heading',{name:'Teilnehmende',exact:true}).count(),0);
  assert.equal(await host.getByRole('heading',{name:'Punkte sammeln',exact:true}).count(),0);
  assert.equal(await host.locator('.bluff-phase,.bluff-source,[data-action="stop_timer"]').count(),0);
  for(const text of ['Antworten eingeben','Anonyme Antworten','Wahrheit finden','Die Antworten bleiben verborgen, bis alle abgegeben haben und du „Antworten anzeigen“ klickst.','Alle Antworten sind anonym. Die Abstimmung beginnt, sobald die Spielleitung sie startet.','Eine Antwort ist wahr. Welche?']){
   assert.equal(await host.getByText(text,{exact:true}).count(),0,'Board omits: '+text);
  }
  const layout=await host.evaluate(()=>{
   const grid=document.querySelector('.bluff-grid').getBoundingClientRect(),side=document.querySelector('.live-sidebar').getBoundingClientRect(),main=document.querySelector('.bluff-host-main')?.getBoundingClientRect();
   return {right:side.x>=grid.x+grid.width/2,beside:!main||side.x>=main.right};
  });
  assert(layout.right&&layout.beside,'Standings remain on the right in '+phase);
  if(['bluff','vote'].includes(phase)){
   assert.equal(await host.locator('.bluff-timer label').count(),0);
   assert.equal(await host.locator('[data-action="timer"] svg').count(),1);
   assert.equal((await host.locator('[data-action="timer"]').innerText()).trim(),'');
   assert.equal(await host.locator('[data-action="timer"]').getAttribute('aria-label'),'Timer starten oder neu setzen');
   const position=await host.locator('.bluff-timer').evaluate(el=>{
    const timer=el.getBoundingClientRect(),panel=el.closest('.panel').getBoundingClientRect();
    return {right:panel.right-timer.right,bottom:panel.bottom-timer.bottom};
   });
   assert(position.right>=0&&position.right<=28&&position.bottom>=0&&position.bottom<=28,'Clock sits at the lower right of the question card');
  }
 }
 await checkBoard('lobby');
 const players=[];
 for(const name of ['Ada','Ben','Cleo']){const c=await context(false,{width:390,height:844}),page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/join.html?code='+code+'&kind=bluff');await page.waitForURL('**/bluff/student.html?code=*');assert.equal(await page.locator('.app-nav').count(),0);assert.equal(await page.locator('a[href]').count(),0);await page.locator('#playerName').fill(name);await page.locator('#joinForm button').click();await page.getByRole('heading',{name:'Punkte sammeln',exact:true}).waitFor();players.push(page);}

 async function checkPlayer(page,phase){
  assert.equal(await page.locator('.bluff-code,.bluff-phase,.bluff-source,.studio-header,#connectionStatus').count(),0);
  assert.equal(await page.locator('.live-sidebar').count(),0,'Player standings must not be a sticky scrolling sidebar');
  const first=page.locator('.bluff-player-grid > .panel').first();
  if(phase==='lobby'){
   assert(await first.getByRole('heading',{name:'Punkte sammeln',exact:true}).isVisible());
   assert((await first.innerText()).includes('Jede Stimme für deine Antwort'));
   assert((await first.innerText()).includes('Du kannst deine eigene Antwort nicht wählen.'));
   assert(!(await first.innerText()).includes('Gleiche Bluffs werden zusammengefasst'));
   assert.equal(await page.locator('.bluff-player-main').count(),0,'No separate lobby/code card');
  }else{
   assert.equal(await page.getByRole('heading',{name:'Punkte sammeln',exact:true}).count(),0);
   assert(await first.evaluate(el=>el.classList.contains('bluff-player-main')),'Active card comes first');
  }
  for(const text of ['Antworten eingeben','Anonyme Antworten','Wahrheit finden','Spiel beendet','Deine Antwort bleibt bis zur Freigabe verborgen und erscheint dann anonym.','Alle Antworten sind anonym. Die Abstimmung beginnt, sobald die Spielleitung sie startet.','Eine Antwort ist wahr. Welche?']){
   assert.equal(await page.getByText(text,{exact:true}).count(),0,'Player omits: '+text);
  }
  const list=page.locator(phase==='ended'?'.bluff-player-main':'.bluff-player-standings .ranking-panel');
  assert.equal(await list.locator('.bluff-score').count(),3);
  assert(await list.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Every player row fits without scrolling inside the card');
  if(phase==='bluff'){
   assert.equal(await page.locator('#sendBluff').innerText(),'Antwort abgeben');
  }
  if(phase==='ended'){
   assert(await first.getByRole('heading',{name:'Platzierung',exact:true}).isVisible());
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Player page fits the phone');
 }
 for(const page of players)await page.waitForFunction(()=>document.querySelectorAll('.bluff-score').length===3);
 await checkPlayer(players[0],'lobby');
 await players[0].screenshot({path:path.join(output,'bluff-lobby-mobile.png'),fullPage:true});
 // Anonymous players cannot open the dashboard application list even by URL.
 const anonymousHub=await players[0].context().newPage();await anonymousHub.goto(base+'/index.html');await anonymousHub.getByText('Bitte melde dich mit deinem Lehrkraftkonto an, um die Anwendungen zu öffnen.',{exact:true}).waitFor();assert(await anonymousHub.locator('#teacherApps').isHidden());assert.equal(await anonymousHub.locator('.app-card:visible').count(),0);assert(await anonymousHub.locator('#loginLink').isVisible());await anonymousHub.close();
 await host.locator('.bluff-start-card').click({position:{x:12,y:12}});await players[0].locator('#bluffAnswer').waitFor();assert.equal(await host.locator('[data-action="open_bluff"]').count(),0);assert(await host.locator('[data-action="show_answers"]').isDisabled());
 await host.locator('.bluff-host-main').waitFor();await checkBoard('bluff');
 await host.getByText('0 von 3 haben eine Antwort eingegeben.',{exact:true}).waitFor();
 await checkPlayer(players[0],'bluff');
 const questionGap=await host.evaluate(()=>{
  const question=document.querySelector('.bluff-host-main .bluff-question').getBoundingClientRect(),button=document.querySelector('[data-action="show_answers"]').getBoundingClientRect();
  return button.top-question.bottom;
 });
 assert(questionGap>=0&&questionGap<90,'Question and reveal button stay close without a fixed-height spacer');

 assert.equal(await host.locator('.bluff-score.has-answer').count(),0);
 const activeCategory=sql('select category from private.bluff_rounds where session_id='+sqlLiteral(sid)+' and round_index=0');
 if(activeCategory)assert.equal(await host.getByText(activeCategory,{exact:true}).count(),0);

 // Typing and paste change the actual value, including umlauts and sharp-S.
 await players[0].locator('#bluffAnswer').fill('straße, öl & grüße 42!');
 assert.equal(await players[0].locator('#bluffAnswer').inputValue(),'STRASSE, ÖL & GRÜSSE 42!');
 await players[0].locator('#bluffAnswer').evaluate(el=>{el.value='klein eingefügt';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));});
 assert.equal(await players[0].locator('#bluffAnswer').inputValue(),'KLEIN EINGEFÜGT');
 await players[0].locator('#bluffAnswer').evaluate(el=>{el.value='abßcd';el.setSelectionRange(3,3);el.dispatchEvent(new InputEvent('input',{bubbles:true}));});
 assert.equal(await players[0].locator('#bluffAnswer').inputValue(),'ABSSCD');
 assert.equal(await players[0].locator('#bluffAnswer').evaluate(el=>el.selectionStart),4);
 for(let i=0;i<players.length;i++){await players[i].locator('#bluffAnswer').fill(i<2?'Ein gemeinsamer Bluff':'Eine andere Erfindung');await players[i].locator('#sendBluff').click();await players[i].getByText('✓ Gespeichert: '+(i<2?'EIN GEMEINSAMER BLUFF':'EINE ANDERE ERFINDUNG'),{exact:true}).waitFor();assert.equal(await players[i].locator('#sendBluff').innerText(),'Antwort aktualisieren');}
 await players[0].reload();await players[0].locator('#bluffAnswer').waitFor();assert.equal(await players[0].locator('#bluffAnswer').inputValue(),'EIN GEMEINSAMER BLUFF');
 assert.equal(await players[0].locator('.bluff-option').count(),0);const own=await players[0].evaluate(()=>window.__payloads.filter(p=>p.name==='bluff_player_state').at(-1).data.data);assert.deepEqual(own.entries,[]);assert.equal(own.correct_answer,null);
 await host.waitForFunction(()=>window.__payloads.filter(p=>p.name==='bluff_host_state').at(-1)?.data.data.players.every(p=>p.submitted));
 const hidden=await host.evaluate(()=>window.__payloads.filter(p=>p.name==='bluff_host_state').at(-1).data.data);assert.deepEqual(hidden.entries,[]);assert.deepEqual(hidden.options,[]);assert.equal(hidden.correct_answer,null);assert.equal(await host.locator('.bluff-option').count(),0);assert.equal(await host.getByText('EIN GEMEINSAMER BLUFF',{exact:true}).count(),0);
 
 await host.locator('.bluff-score.has-answer').nth(2).waitFor();
 assert.equal(await host.locator('.bluff-score.has-answer .bluff-answer-mark').count(),3);
 await host.getByText('3 von 3 haben eine Antwort eingegeben.',{exact:true}).waitFor();
 await checkBoard('bluff');
await host.screenshot({path:path.join(output,'bluff-hidden-host.png'),fullPage:true});
 await host.locator('[data-action="show_answers"]').click();for(const page of players)await page.locator('.bluff-option').first().waitFor();
 assert.equal(await host.locator('.bluff-option').count(),3);assert((await host.locator('.bluff-option h3').allTextContents()).every(t=>t===t.toUpperCase()));
 for(const page of players){assert.equal(await page.locator('[data-action="vote"]').count(),0);assert.equal(await page.locator('#bluffForm').count(),0);const preview=await page.evaluate(()=>window.__payloads.filter(p=>p.name==='bluff_player_state').at(-1).data.data);assert.equal(preview.phase,'answers');assert(preview.options.every(o=>!('authors' in o)&&!('is_truth' in o)&&!('voters' in o)));}
 const anonymous=await host.evaluate(()=>window.__payloads.filter(p=>p.name==='bluff_host_state').at(-1).data.data);assert(anonymous.options.every(o=>!('authors' in o)&&!('is_truth' in o)&&!('voters' in o)));assert.deepEqual(anonymous.entries,[]);
 await checkBoard('answers');await checkPlayer(players[0],'answers');await host.screenshot({path:path.join(output,'bluff-anonymous-host.png'),fullPage:true});await players[0].screenshot({path:path.join(output,'bluff-anonymous-mobile.png'),fullPage:true});
 await host.locator('[data-action="start_vote"]').click();for(const page of players)await page.locator('[data-action="vote"]').first().waitFor();
 await checkBoard('vote');await checkPlayer(players[0],'vote');assert.equal(await host.locator('.bluff-score.has-answer,.bluff-score.has-vote').count(),0);

 const truth=sql('select id from private.bluff_options where session_id='+sqlLiteral(sid)+' and round_index=0 and is_truth');const fake=sql('select id from private.bluff_options where session_id='+sqlLiteral(sid)+' and round_index=0 and cardinality(author_ids)=2');
 assert(await players[0].locator('[data-option-id="'+fake+'"] button').isDisabled());const votePayload=await players[2].evaluate(()=>window.__payloads.filter(p=>p.name==='bluff_player_state').at(-1).data.data);assert(votePayload.options.every(o=>!('authors' in o)&&!('is_truth' in o)&&!('voters' in o)));
 await players[0].locator('[data-action="vote"][data-id="'+truth+'"]').click();await players[1].locator('[data-action="vote"][data-id="'+truth+'"]').click();await players[2].locator('[data-action="vote"][data-id="'+fake+'"]').click();
 await players[2].getByText('✓ Deine Stimme ist gespeichert.',{exact:true}).waitFor();
 await host.locator('.bluff-score.has-vote').nth(2).waitFor();
 assert.equal(await host.locator('.has-vote [aria-label="Stimme abgegeben"]').count(),3);
await players[2].screenshot({path:path.join(output,'bluff-vote-mobile.png'),fullPage:true});assert(await players[2].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await host.locator('[data-action="reveal"]').click();await host.waitForFunction(()=>document.querySelectorAll('.bluff-option.revealed').length===3);assert.equal(await host.locator('[data-action="reveal_next"]').count(),0);
 await host.getByText(/Punkte vergeben · echte Antwort:/).waitFor();await checkBoard('leaderboard');
 const fakeCard=host.locator('[data-option-id="'+fake+'"]');assert.deepEqual(await fakeCard.locator('.bluff-authors .bluff-person-name').allTextContents(),['Ada','Ben']);assert.equal(await fakeCard.locator('.bluff-voter .bluff-person-name').innerText(),'Cleo');assert.equal(await fakeCard.locator('.bluff-avatar[aria-hidden="true"]').count(),3);assert.equal(await host.getByText(/hat geblufft|haben geblufft/).count(),0);
 const geometry=await fakeCard.evaluate(el=>{const a=el.querySelector('.bluff-option-answer').getBoundingClientRect(),v=el.querySelector('.bluff-voters').getBoundingClientRect();return {right:v.x>=a.right,font:parseFloat(getComputedStyle(el.querySelector('.bluff-voter')).fontSize)}});assert(geometry.right);assert(geometry.font>=22);
 await players[0].locator('.bluff-option.revealed').first().waitFor();assert.equal(await players[0].locator('.bluff-option.revealed').count(),3);assert.equal(await players[0].locator('.app-nav').count(),0);assert.equal(await players[0].locator('a[href]').count(),0);assert(await players[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await players[0].locator('.bluff-voter').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=18));await players[0].screenshot({path:path.join(output,'bluff-reveal-mobile.png'),fullPage:true});assert.equal(sql('select sum(score) from private.bluff_players where session_id='+sqlLiteral(sid)),'6');await host.waitForFunction(()=>document.getAnimations().every(a=>a.playState==='finished'));await host.screenshot({path:path.join(output,'bluff-reveal-desktop.png'),fullPage:true});
 await host.locator('[data-action="next"]').click();await players[0].locator('#bluffAnswer').waitFor();assert.equal(await host.locator('[data-action="open_bluff"]').count(),0);await host.locator('[data-action="timer"]').click();await host.locator('#countdown').getByText(/Noch/).waitFor();
 await checkBoard('bluff');assert.equal(await host.locator('.bluff-score.has-answer').count(),0);
 await host.setViewportSize({width:390,height:844});
 assert(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Compact board has no horizontal overflow');
 assert(await host.locator('[data-action="timer"]').isVisible());
 await host.screenshot({path:path.join(output,'bluff-timer-mobile.png'),fullPage:true});
 await host.setViewportSize({width:1280,height:900});

 // Host can end early; already awarded points persist and mobile clients see final results.
 await host.locator('[data-action="end"]').click();await host.waitForURL('**/quiz-studio/index.html');await players[0].getByRole('heading',{name:'Platzierung',exact:true}).waitFor();await checkPlayer(players[0],'ended');await players[0].screenshot({path:path.join(output,'bluff-results-mobile.png'),fullPage:true});assert.equal(sql('select sum(score) from private.bluff_players where session_id='+sqlLiteral(sid)),'6');
 // Finish a complete one-round game using “Endergebnis anzeigen”, then reload the result.
 await host.locator('[data-bluff-action="random"]').click();await host.locator('#bluffRoundCount').fill('1');await host.locator('#bluffQuizForm [type="submit"]').click();await host.waitForURL('**/bluff/live.html?session=*');
 const finalSid=new URL(host.url()).searchParams.get('session');
 await host.locator('[data-action="participation"]').click();const finalCode=await host.locator('.bluff-join-code').innerText();await host.keyboard.press('Escape');
 for(let i=0;i<players.length;i++){
  await players[i].goto(base+'/apps/quiz-studio/bluff/student.html?code='+finalCode);
  await players[i].locator('#playerName').fill(['Ada','Ben','Cleo'][i]);await players[i].locator('#joinForm button').click();
  await players[i].locator('.bluff-lobby-rules').waitFor();
 }
 await host.waitForFunction(()=>document.querySelectorAll('.bluff-score').length===3);
 await host.locator('.bluff-start-card').focus();await host.keyboard.press('Enter');
 for(let i=0;i<players.length;i++){
  await players[i].locator('#bluffAnswer').fill('Erfundene Testantwort '+(i+1));await players[i].locator('#sendBluff').click();
  await players[i].getByText(/✓ Gespeichert:/).waitFor();
 }
 await host.locator('[data-action="show_answers"]').waitFor();await host.waitForFunction(()=>!document.querySelector('[data-action="show_answers"]').disabled);
 await host.locator('[data-action="show_answers"]').click();await host.locator('[data-action="start_vote"]').click();
 const finalTruth=sql('select id from private.bluff_options where session_id='+sqlLiteral(finalSid)+' and round_index=0 and is_truth');
 for(const page of players){await page.locator('[data-action="vote"][data-id="'+finalTruth+'"]').waitFor();await page.locator('[data-action="vote"][data-id="'+finalTruth+'"]').click();}
 await host.locator('[data-action="reveal"]').click();await host.getByRole('button',{name:'Endergebnis anzeigen',exact:true}).waitFor();
 await host.getByRole('button',{name:'Endergebnis anzeigen',exact:true}).click();
 await host.getByRole('heading',{name:'Endplatzierung',exact:true}).waitFor();
 assert.equal(await host.locator('.bluff-final-result .bluff-score').count(),3);
 assert.deepEqual(await host.locator('.bluff-final-result .bluff-score>span:first-child').allTextContents(),['1','1','1']);
 assert.deepEqual(await host.locator('.bluff-final-result .bluff-score>b').allTextContents(),['1 P','1 P','1 P']);
 assert.equal(await host.locator('.ranking-panel,.live-sidebar').count(),0);
 await host.screenshot({path:path.join(output,'bluff-final-host-desktop.png'),fullPage:true});
 await host.setViewportSize({width:390,height:844});assert(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await host.screenshot({path:path.join(output,'bluff-final-host-mobile.png'),fullPage:true});
 await host.reload();await host.getByRole('heading',{name:'Endplatzierung',exact:true}).waitFor();assert.equal(await host.locator('.bluff-final-ranking .bluff-score').count(),3);
 assert.deepEqual(errors,[]);console.log('PASS: real PostgreSQL-backed editor, manual round selection, shared join routing, 3 mobile players, resume, hidden bluffs, own-vote block, anonymous choices, simultaneous reveal, readable author/voter columns, no player dashboard links, 1/2-point scoring, timer and ending');
 }finally{for(const c of contexts)await c.close();await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});

