// Actual PostgreSQL RPCs via a local test bridge. No live accounts or API secrets.
// CI uses psql and an EMPTY yesno_tests database initialized by yesno-db.sql.
// Optional local fallback: YESNO_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');
const teacher='11111111-1111-4111-8111-111111111111',quote=v=>"'"+String(v).replace(/'/g,"''")+"'";
let db;
async function sql(query){
 if(db){const results=await db.exec(query);return results.at(-1)?.rows?.[0]?.value;}
 const lines=execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const result=lines.at(-1);try{return JSON.parse(result);}catch{return result;}
}
const signatures={yesno_question_list:[],yesno_question_save:['p_id','p_question','p_pack'],yesno_question_delete:['p_id'],yesno_game_list:[],yesno_game_save:['p_id','p_name','p_question_ids'],yesno_game_delete:['p_id'],yesno_create:['p_request_id','p_game_id','p_rounds','p_seconds','p_exact','p_near','p_packs'],yesno_create_configured:['p_request_id','p_game_id','p_rounds','p_seconds','p_exact','p_near','p_tolerance','p_reveal_answers','p_packs'],yesno_join:['p_code','p_name','p_token'],yesno_ready:['p_session_id','p_player_id','p_token','p_ready'],yesno_host_state:['p_session_id'],yesno_player_state:['p_session_id','p_player_id','p_token'],yesno_submit:['p_session_id','p_player_id','p_token','p_round','p_answer','p_estimate'],yesno_host_action:['p_session_id','p_round','p_phase','p_action'],classroom_resolve_code:['p_join_code','p_kind_hint'],bluff_quiz_list:[]};
function value(v,key){if(v===null||v===undefined)return 'null';if(Array.isArray(v))return 'array['+v.map(x=>quote(x)).join(',')+']::'+(key==='p_question_ids'?'bigint':'text')+'[]';if(typeof v==='boolean'||typeof v==='number')return String(v);return quote(v);}
const payloads=[],calls=[];
async function queryRpc(name,args,host){
 if(name==='bluff_quiz_list')return {ok:true,quizzes:[]};
 if(!signatures[name])throw Error('Unexpected RPC: '+name);
 const query='select public.'+name+'('+signatures[name].map(k=>k+'=>'+value(args[k],k)).join(',')+') as value';
 if(db)return db.transaction(async tx=>{await tx.exec("select set_config('request.jwt.claim.sub',"+quote(host?teacher:'')+",true);set local role "+(host?'authenticated':'anon'));return (await tx.query(query)).rows[0].value;});
 return sql('begin;select set_config(\'request.jwt.claim.sub\','+quote(host?teacher:'')+',true);set local role '+(host?'authenticated':'anon')+';'+query+';commit;');
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/rpc'){
   let raw='';for await(const c of req)raw+=c;const {name,args={},host}=JSON.parse(raw);calls.push({name,args,host});
   try{const data=await queryRpc(name,args,host);payloads.push({name,args,host,data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));}
   catch(e){res.end(JSON.stringify({error:{message:e.message}}));}return;
  }
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 if(process.env.YESNO_PGLITE_MODULE){
  const {PGlite}=require(process.env.YESNO_PGLITE_MODULE);db=new PGlite();
  let fixture=fs.readFileSync(path.join(__dirname,'yesno-db.sql'),'utf8').replace(/^\\set.*$/mg,'');
  fixture=fixture.replace(/^\\ir .*$/mg,line=>fs.readFileSync(path.resolve(__dirname,line.slice(4).trim()),'utf8'));await db.exec(fixture);
 }
 await sql('insert into auth.users(id) values('+quote(teacher)+') on conflict do nothing');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.mkdirSync(output,{recursive:true});
 const base='http://127.0.0.1:'+server.address().port+'/SchulApp',browser=await chromium.launch({args:['--no-sandbox'],...(process.env.YESNO_CHROMIUM_EXECUTABLE?{executablePath:process.env.YESNO_CHROMIUM_EXECUTABLE}:{})}),contexts=[],errors=[];
 async function context(host,viewport){
  const c=await browser.newContext({viewport});contexts.push(c);
  await c.addInitScript(host=>{
   window.__payloads=[];window.supabase={createClient:()=>({
    auth:{getUser:async()=>({data:{user:host?{id:'11111111-1111-4111-8111-111111111111'}:null}})},
    from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{revision:1,payload:{quizzes:[{id:'classic',title:'Klassisches Quiz',questions:[]}]}}})};return q;},
    async rpc(name,args={}){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,host})}),data=await r.json();window.__payloads.push({name,data});return data;},
    channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c}};return c;},removeChannel(){}
   })};
  },host);
  await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));return c;
 }
 async function screenshot(page,name){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow: '+name);await page.screenshot({path:path.join(output,'yesno-'+name+'.png'),fullPage:true});}
 try{
  const hc=await context(true,{width:1280,height:900}),host=await hc.newPage();host.on('pageerror',e=>errors.push(e.message));host.on('dialog',d=>d.accept());
  await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('#yesnoLibrary .empty').waitFor();await screenshot(host,'library-desktop');
  await host.locator('#yesnoLibrary a[href="yesno/index.html"]').click();await host.locator('#ynQuestionRows article').first().waitFor();
  await host.locator('[data-action="new-question"]').click();await host.locator('[name="question"]').fill('Hast du schon einmal einen Roboter gebaut?');await host.locator('[name="pack"]').fill('Technik');await host.locator('#ynQuestionForm [type="submit"]').click();await host.getByRole('heading',{name:'Hast du schon einmal einen Roboter gebaut?'}).waitFor();
  const qid=await sql('select id as value from private.yesno_questions where owner_id='+quote(teacher)+' order by id desc limit 1');
  await host.locator('[data-question-id="'+qid+'"] [data-action="edit-question"]').click();await host.locator('[name="question"]').fill('Baust du gerne Modelle?');await host.locator('#ynQuestionForm [type="submit"]').click();await host.getByRole('heading',{name:'Baust du gerne Modelle?'}).waitFor();
  await screenshot(host,'questions-desktop');
  await host.getByRole('link',{name:'← Quiz Studio',exact:true}).click();await host.locator('#yesnoLibrary .empty').waitFor();
  await host.locator('[data-yn-action="new"]').click();await host.locator('[name="gameName"]').fill('Unsere Ja/Nein-Runde');const pack=host.locator('[name="selectPack"][value="Freizeit"]');await pack.check();assert.equal(await host.locator('[name="question"]:checked').count(),5);await host.locator('[name="question"]:checked').first().uncheck();assert(await pack.evaluate(c=>c.indeterminate));await pack.check();await pack.uncheck();assert.equal(await host.locator('[name="question"]:checked').count(),0);await host.locator('[name="question"][value="'+qid+'"]').check();await host.locator('[name="question"]').first().check();await host.locator('#ynGameForm [type="submit"]').click();await host.getByRole('heading',{name:'Unsere Ja/Nein-Runde'}).waitFor();
  await host.reload();await host.locator('[data-yn-action="edit"]').click();await host.locator('#ynGameForm').waitFor();assert.equal(await host.locator('[name="question"]:checked').count(),2);await host.locator('[name="gameName"]').fill('Die Gruppe schätzt');await host.locator('#ynGameForm [type="submit"]').click();await host.getByRole('heading',{name:'Die Gruppe schätzt'}).waitFor();
  await host.setViewportSize({width:390,height:844});await screenshot(host,'library-mobile');
  await host.locator('[data-yn-action="start"]').click();assert.equal(await host.locator('[name="seconds"]').inputValue(),'60');assert.equal(await host.locator('[name="tolerance"]').inputValue(),'1');assert.equal(await host.locator('[name="visibility"]').inputValue(),'secret');await host.locator('[name="rounds"]').fill('2');await host.locator('[name="exact"]').fill('5');await host.locator('[name="near"]').fill('2');await host.locator('#ynGameForm [type="submit"]').click();await host.waitForURL('**/yesno/live.html?session=*');await host.locator('.yn-lobby-start').waitFor();
  const sid=new URL(host.url()).searchParams.get('session');assert(await host.locator('[data-action="start"]').isDisabled());assert.equal(await host.locator('#app .yn-code,#app .yn-qr,.yn-player').count(),0);assert.equal(await host.locator('.yn-lobby-empty').innerText(),'noch keine Teilnehmer');assert.deepEqual(await host.locator('.yn-rules li').allTextContents(),['Genau richtig: 5 Punkte.','Bis zu 1 Personen daneben: 2 Punkte.','Sonst oder ohne Abgabe: 0 Punkte.']);assert(await host.locator('.yn-lobby-start').evaluate(el=>el.getBoundingClientRect().height>=220));await screenshot(host,'lobby-mobile');
  await host.locator('[data-action="participation"]').click();await host.locator('dialog .yn-qr img').waitFor();const code=await host.locator('dialog .yn-code').innerText(),joinUrl=await host.locator('.yn-join-link').getAttribute('href');assert.equal(await host.locator('.yn-join-link').innerText(),'Teilnahmeseite öffnen');assert(new URL(joinUrl).pathname==='/SchulApp/join.html');assert.equal(new URL(joinUrl).searchParams.get('kind'),'yesno');const qr=await host.locator('dialog canvas').evaluate(c=>({width:c.width,height:c.height,pixels:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}));assert.equal(require('jsqr')(new Uint8ClampedArray(qr.pixels),qr.width,qr.height).data,joinUrl);await screenshot(host,'participation-mobile');await host.keyboard.press('Escape');
  const players=[];
  for(const name of ['Ada','Ben','Cleo']){
   const c=await context(false,{width:390,height:844}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(base+'/join.html?kind=yesno&code='+code);await p.waitForURL('**/yesno/student.html?code=*');await p.locator('[name="playerName"]').fill(name);await p.locator('#ynJoinForm button').click();await p.getByRole('heading',{name:'Wartelobby',exact:true}).waitFor();assert.equal(await p.locator('.app-nav,a[href],[data-action="ready"],.yn-player,.yn-heading,.studio-header').count(),0);assert.deepEqual(await p.locator('.yn-rules li').allTextContents(),['Genau richtig: 5 Punkte.','Bis zu 1 Personen daneben: 2 Punkte.','Sonst oder ohne Abgabe: 0 Punkte.']);assert.equal(await p.locator('.yn-lobby-score.me strong').innerText(),name);players.push(p);
  }
  await host.locator('[data-action="start"]:enabled').waitFor();await host.waitForFunction(()=>document.querySelectorAll('.yn-lobby-score').length===3);await host.setViewportSize({width:1280,height:900});assert(await host.locator('.yn-lobby-grid').evaluate(el=>{const main=el.firstElementChild.getBoundingClientRect(),scores=el.lastElementChild.getBoundingClientRect();return scores.left>main.right&&Math.abs(scores.top-main.top)<2;}));await screenshot(host,'lobby-desktop');await players[0].waitForFunction(()=>document.querySelectorAll('.yn-lobby-score').length===3);await screenshot(players[0],'waiting-mobile');await host.locator('[data-action="start"]').click();await players[0].locator('#ynAnswerForm').waitFor();assert.equal(await host.locator('.yn-lobby-grid').count(),0);assert.equal(await host.locator('body.yn-in-lobby').count(),0);
  assert(await players[0].locator('#ynAnswerForm [type="submit"]').isDisabled());await host.locator('.yn-question').waitFor();assert.equal(await host.locator('.yn-code,.yn-qr,[data-action="participation"]').count(),0);assert.equal(await host.locator('.studio-title').innerText(),'Ja oder Nein');assert.equal(await host.locator('.yn-player').count(),0);
  for(const p of players){assert.equal(await p.locator('h1,.studio-header').count(),0);assert.equal(await p.getByRole('heading',{name:'Rangliste',exact:true}).count(),1);assert.equal(await p.getByText('Bitte wählen',{exact:true}).count(),0);assert.equal(await p.getByText(/0 bis \d+ Personen|Erst beide Eingaben auswählen/).count(),0);assert.equal(await p.locator('#ynEstimateValue').isVisible(),false);}
  assert.equal(await players[0].locator('.yn-player,input[type="range"],input[type="number"],#ynEstimateSlider,#ynEstimateNumber').count(),0);assert.equal(await players[0].locator('[data-estimate]').count(),4);
  await players[0].locator('[data-answer="yes"]').click();assert(await players[0].locator('#ynAnswerForm [type="submit"]').isDisabled());await players[0].locator('[data-estimate="1"]').click();await players[0].waitForFunction(()=>getComputedStyle(document.querySelector('[data-answer="yes"]')).backgroundColor==='rgb(56, 107, 100)');await screenshot(players[0],'question-mobile');await players[0].locator('#ynAnswerForm [type="submit"]').click();await players[0].getByText('✓ Deine Antwort wurde gespeichert',{exact:true}).waitFor();
  await players[0].reload();await players[0].getByText('✓ Deine Antwort wurde gespeichert',{exact:true}).waitFor();
  await host.waitForFunction(()=>window.__payloads.some(p=>p.name==='yesno_host_state'&&p.data.data.phase==='question'&&p.data.data.players.some(x=>x.submitted)));
  const hidden=await host.evaluate(()=>window.__payloads.filter(p=>p.name==='yesno_host_state').at(-1).data.data);assert.equal(hidden.yes_count,null);assert.deepEqual(hidden.results,[]);assert.equal(hidden.own_answer,null);assert(hidden.players.every(p=>!('answer'in p)&&!('estimate'in p)));
  await host.locator('.yn-lobby-score.has-vote').waitFor();await players[1].locator('.yn-lobby-score.has-vote').waitFor();assert.equal(await host.locator('.yn-vote-mark').count(),1);assert.equal(await players[1].locator('.yn-vote-mark').count(),1);assert.equal(await host.locator('.yn-lobby-score.has-vote').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(229, 241, 232)');await host.setViewportSize({width:1280,height:900});await screenshot(host,'hidden-host');
  for(let i=1;i<3;i++){await players[i].locator('[data-answer="no"]').click();await players[i].locator('[data-estimate="'+(i+1)+'"]').click();await players[i].locator('#ynAnswerForm [type="submit"]').click();}
  await host.locator('.yn-total').waitFor();assert.equal(await host.locator('.yn-total').innerText(),'1');await players[0].getByText('Ada · Volltreffer!',{exact:true}).waitFor();assert.equal(await players[0].locator('.yn-result-row.exact .yn-points').innerText(),'+5');assert.equal(await host.getByText('Antwort:',{exact:false}).count(),0);assert(payloads.filter(p=>p.name==='yesno_host_state'&&p.data.results?.length).every(p=>p.data.results.every(r=>!('answer'in r))));await screenshot(host,'results-desktop');await screenshot(players[0],'results-mobile');
  for(const p of players){await p.locator('.yn-total').waitFor();assert.equal(await p.locator('h1,.studio-header,.yn-question,.yn-vote-mark').count(),0);assert.equal(await p.getByText('Persönliche Ja/Nein-Antworten werden nicht veröffentlicht.',{exact:true}).count(),0);assert.equal(await p.getByText('Die Spielleitung startet die nächste Runde.',{exact:true}).count(),0);assert(await p.locator('.yn-grid').evaluate(el=>el.lastElementChild.getBoundingClientRect().top>=el.firstElementChild.getBoundingClientRect().bottom));assert.equal(await p.locator('.yn-player-standings').evaluate(el=>getComputedStyle(el).position),'static');}
  await players[0].setViewportSize({width:1280,height:900});await screenshot(players[0],'results-player-desktop');await players[0].setViewportSize({width:390,height:844});assert.equal(await host.locator('.studio-title').innerText(),'Ja oder Nein');
  await host.locator('[data-action="next"]').click();await players[0].locator('#ynAnswerForm').waitFor();
  // Keyboard-only answer and number buttons; drafts survive other people's updates.
  await players[0].locator('[data-answer="no"]').focus();await players[0].keyboard.press('Enter');await players[0].locator('[data-estimate="0"]').focus();await players[0].keyboard.press('Enter');
  await players[1].locator('[data-answer="yes"]').click();await players[1].locator('[data-estimate="2"]').click();await players[1].locator('#ynAnswerForm [type="submit"]').click();
  await players[0].waitForFunction(()=>window.__payloads.filter(p=>p.name==='yesno_player_state').at(-1)?.data.data.players.some(p=>p.name==='Ben'&&p.submitted));
  assert.equal(await players[0].locator('[data-answer="no"]').getAttribute('aria-pressed'),'true');assert.equal(await players[0].locator('[data-estimate="0"]').getAttribute('aria-pressed'),'true');assert.equal(await players[0].locator('.yn-player').count(),0);await host.locator('.yn-lobby-score.has-vote').first().waitFor();assert.equal(await players[0].locator('#ynEstimateValue').innerText(),'0');
  await players[0].locator('#ynAnswerForm [type="submit"]').click();await players[0].getByText('✓ Deine Antwort wurde gespeichert',{exact:true}).waitFor();
  await sql('update private.yesno_sessions set deadline=clock_timestamp()-interval \'1 second\' where id='+quote(sid));
  await host.locator('.yn-podium').waitFor();await players[2].locator('.yn-podium').waitFor();assert(await host.getByText('Ohne Abgabe: 1',{exact:true}).isVisible());await screenshot(host,'final-desktop');await screenshot(players[2],'final-mobile');
  assert.equal(await host.locator('[data-action="next"]').count(),0);
  const totals=await sql('select jsonb_agg(jsonb_build_object(\'name\',p.name,\'score\',coalesce((select sum(points) from private.yesno_answers a where a.player_id=p.id),0)) order by p.name) as value from private.yesno_players p where session_id='+quote(sid));
  assert.deepEqual(totals,[{name:'Ada',score:7},{name:'Ben',score:4},{name:'Cleo',score:0}]);
  for(const p of payloads.filter(x=>x.name==='yesno_host_state'))assert(!JSON.stringify(p.data).includes('token_hash'));
  // Catalog deletion and saved snapshot retention.
  await host.goto(base+'/apps/quiz-studio/yesno/index.html');await host.locator('[data-question-id="'+qid+'"] [data-action="delete-question"]').click();await host.locator('[data-question-id="'+qid+'"]').waitFor({state:'detached'});
  await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('[data-yn-action="edit"]').click();await host.locator('#ynGameForm').waitFor();assert.equal(await host.locator('[name="question"]:checked').count(),2);await host.keyboard.press('Escape');
  await host.locator('[data-yn-action="delete"]').click();await host.locator('#yesnoLibrary .empty').waitFor();
  await host.locator('[data-yn-action="random"]').click();await host.locator('[name="rounds"]').fill('1');for(const checkbox of await host.locator('[name="pack"]').all())await checkbox.uncheck();await host.locator('[name="pack"][value="Freizeit"]').check();await host.locator('#ynGameForm [type="submit"]').click();await host.waitForURL('**/yesno/live.html?session=*');await host.locator('[data-action="end"]').click();await host.getByRole('heading',{name:'Spiel beendet',exact:true}).waitFor();
  // Open game: wider tolerance, answers visible only after reveal.
  await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('[data-yn-action="random"]').click();await host.locator('[name="rounds"]').fill('1');await host.locator('[name="tolerance"]').fill('2');await host.locator('[name="visibility"]').selectOption('open');await host.locator('#ynGameForm [type="submit"]').click();await host.waitForURL('**/yesno/live.html?session=*');await host.locator('[data-action="participation"]').click();await host.locator('dialog .yn-code').waitFor();const openCode=await host.locator('dialog .yn-code').innerText();await host.keyboard.press('Escape');
  for(let i=0;i<3;i++){const p=players[i];await p.goto(base+'/apps/quiz-studio/yesno/student.html?code='+openCode);await p.locator('[name="playerName"]').fill(['Ada','Ben','Cleo'][i]);await p.locator('#ynJoinForm button').click();await p.getByRole('heading',{name:'Wartelobby',exact:true}).waitFor();}
  await host.locator('[data-action="start"]:enabled').waitFor();await host.locator('[data-action="start"]').click();await players[0].locator('#ynAnswerForm').waitFor();
  for(let i=0;i<3;i++){const p=players[i];await p.locator('[data-answer="'+(i===0?'yes':'no')+'"]').click();await p.locator('[data-estimate="'+[1,3,0][i]+'"]').click();await p.locator('#ynAnswerForm [type="submit"]').click();if(i===0){await p.getByText('✓ Deine Antwort wurde gespeichert',{exact:true}).waitFor();const st=await queryRpc('yesno_host_state',{p_session_id:new URL(host.url()).searchParams.get('session')},true);assert.equal(st.reveal_answers,true);assert.deepEqual(st.results,[]);assert.equal(st.yes_count,null);}}
  await host.locator('.yn-podium').waitFor();assert.equal(await host.locator('.yn-result-row').filter({hasText:'Ada'}).innerText().then(t=>t.includes('Ada (JA)')&&t.includes('+3')),true);assert.equal(await host.locator('.yn-result-row').filter({hasText:'Ben'}).innerText().then(t=>t.includes('Ben (NEIN)')&&t.includes('+1')),true);assert.equal(await host.locator('.yn-revealed-answer.is-yes').evaluate(el=>getComputedStyle(el).color),'rgb(35, 115, 68)');assert.equal(await host.locator('.yn-revealed-answer.is-no').first().evaluate(el=>getComputedStyle(el).color),'rgb(178, 44, 50)');await screenshot(host,'open-results-desktop');
  assert.deepEqual(errors,[]);console.log('PASS: real database + desktop/mobile UI, catalog CRUD, saved/random games, ready lobby, secret dual input, resume, custom points, auto reveal, timeout, podium, keyboard input and layout');
 }catch(e){for(const c of contexts)for(const p of c.pages()){console.error('Test page:',p.url(),await p.locator('#appMessage,[data-yn-status],#cloudStatus').allTextContents());await p.screenshot({path:path.join(output,'yesno-failure-'+contexts.indexOf(c)+'.png'),fullPage:true}).catch(()=>{});}console.error('Browser errors:',errors,'Recent RPCs:',payloads.slice(-3));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));if(db)await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
