// Test-only RPC bridge to actual PostgreSQL. No live project or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const teacher='11111111-1111-4111-8111-111111111111',lit=s=>"'"+String(s).replace(/'/g,"''")+"'";
const signatures={closer_question_list:[],closer_question_save:['p_id','p_question','p_answer','p_unit'],closer_question_delete:['p_id'],closer_quiz_list:[],closer_quiz_save:['p_id','p_name','p_question_ids'],closer_quiz_delete:['p_id'],closer_quiz_start:['p_id'],closer_create:['p_round_count','p_question_ids'],closer_join:['p_code','p_name','p_token'],closer_host_state:['p_session_id'],closer_player_state:['p_session_id','p_player_id','p_token'],closer_host_action:['p_session_id','p_round','p_phase','p_action'],closer_guess:['p_session_id','p_player_id','p_token','p_round','p_value'],classroom_resolve_code:['p_join_code','p_kind_hint']};
const participant=new Set(['closer_join','closer_player_state','closer_guess','classroom_resolve_code']);
function value(v){if(v==null)return 'null';if(Array.isArray(v))return 'array['+v.map(Number).join(',')+']::bigint[]';return typeof v==='number'?String(v):lit(v);}
let serial=Promise.resolve();
const sql=query=>execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim().split('\n').filter(Boolean).at(-1);
async function rpc(name,args,host){
 if(!signatures[name]){if(['bluff_quiz_list','rather_quiz_list','same_quiz_list','yesno_game_list'].includes(name))return {ok:true,quizzes:[],games:[],sessions:[]};throw Error('Unknown RPC '+name);}
 if(!host&&!participant.has(name))throw Error('RPC denied');
 return JSON.parse(sql('begin;'+(host?"select set_config('request.jwt.claim.sub',"+lit(teacher)+",true);set local role authenticated;":'set local role anon;')+'select public.'+name+'('+signatures[name].map(k=>k+'=>'+value(args[k])).join(',')+');commit;'));
}
(async()=>{
 sql('insert into auth.users(id) values('+lit(teacher)+') on conflict do nothing');
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/rpc'){let raw='';for await(const c of req)raw+=c;const {name,args={},host}=JSON.parse(raw);const task=serial.then(()=>rpc(name,args,host));serial=task.catch(()=>{});try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:await task}));}catch(e){console.error(name,e);res.end(JSON.stringify({error:{message:e.message}}));}return;}
  const url=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+url);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({args:['--no-sandbox']}),contexts=[],errors=[];
 async function page(host,viewport){const c=await browser.newContext({viewport});contexts.push(c);await c.addInitScript(host=>{
  window.__payloads=[];window.supabase={createClient:()=>({from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{revision:1,payload:{quizzes:[{id:'classic',title:'Klassisches Quiz',questions:[]}]}}}}};return q;},auth:{async getUser(){return {data:{user:host?{id:'11111111-1111-4111-8111-111111111111'}:null}}}},async rpc(name,args){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args,host})});const payload=await r.json();window.__payloads.push({name,payload});return payload;},channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c;}};return c;},removeChannel(){}})};
 },host);await c.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());return p;}
 const shot=async(p,name)=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+name);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(output,'closer-'+name+'.png'),fullPage:true});};
 const green='rgb(50, 154, 119)',white='rgb(255, 255, 255)';
 try{
  // Dashboard: the sixth tile, consistent with the other games.
  const host=await page(true,{width:1280,height:900});await host.goto(base+'/apps/quiz-studio/index.html');await host.locator('#closerLibrary .empty').waitFor();
  assert.equal(await host.locator('#closerLibrary h2').innerText(),'Näher dran');
  await host.locator('#closerLibrary a').click();await host.waitForURL('**/closer/index.html');await host.locator('[data-action="edit-question"]').first().waitFor();
  assert.equal(await host.locator('[data-action="edit-question"]').count(),10);
  assert(await host.getByText('Lösung: 42,195 km').count()===1,'Decimal answers are shown the German way');
  // Catalogue: German decimals are accepted, words are rejected before saving.
  await host.locator('[data-action="new-question"]').click();await host.locator('#questionText').fill('Wie viele Seiten hat das Testbuch?');await host.locator('#questionAnswer').fill('ungefähr hundert');await host.locator('#questionForm [type="submit"]').click();
  await host.getByText('Gib die Lösung als Zahl ein, z. B. 157 oder 42,195.',{exact:true}).waitFor();
  await host.locator('#questionAnswer').fill('100');await host.locator('#questionUnit').fill('Seiten');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Wie viele Seiten hat das Testbuch?',{exact:true}).waitFor();
  await host.locator('[data-action="new-question"]').click();await host.locator('#questionText').fill('Wie lang ist der Testflur?');await host.locator('#questionAnswer').fill('12,5');await host.locator('#questionUnit').fill('m');await host.locator('#questionForm [type="submit"]').click();await host.getByText('Lösung: 12,5 m',{exact:true}).waitFor();
  const flat=await host.evaluate(async()=>{await document.fonts.ready;const css=sel=>getComputedStyle(document.querySelector(sel));const panel=css('#app .panel'),title=css('.studio-title');return {body:css('body').backgroundColor,panel:[panel.borderTopWidth,panel.borderTopColor,panel.boxShadow],title:title.color,font:title.fontFamily,nav:css('.app-nav').display,home:document.querySelector('.studio-home')?.getAttribute('href')};});
  assert.deepEqual({...flat,font:undefined},{body:white,panel:['4px',green,'none'],title:green,font:undefined,nav:'none',home:'../../../index.html'});
  assert.match(flat.font,/^"?Comic Neue"?/);
  await shot(host,'catalog-desktop');
  await host.locator('.studio-header a.btn[href="../index.html"]').click();await host.locator('#closerLibrary .empty').waitFor();
  // Saved game from two chosen questions; editing keeps the selection.
  await host.locator('[data-closer-action="new"]').click();await host.locator('#closerQuizName').fill('Unsere Schätzrunde');
  await host.locator('.bluff-question-choice').filter({hasText:'Testbuch'}).locator('input').check();await host.locator('.bluff-question-choice').filter({hasText:'Testflur'}).locator('input').check();
  assert.equal(await host.locator('dialog[open]').evaluate(d=>getComputedStyle(d).borderTopColor),green);
  await host.locator('#closerQuizForm [type="submit"]').click();await host.getByText('Unsere Schätzrunde',{exact:true}).waitFor();
  await host.locator('[data-closer-action="edit"]').click();await host.locator('#closerQuizName').waitFor();assert.equal(await host.locator('.bluff-question-choice input:checked').count(),2);await host.keyboard.press('Escape');
  // A random lobby can be created and ended right away.
  await host.locator('[data-closer-action="random"]').click();await host.locator('#closerRoundCount').fill('1');await host.locator('#closerQuizForm [type="submit"]').click();await host.waitForURL('**/closer/live.html?session=*');await host.locator('.bluff-start-card').waitFor();assert(await host.locator('.bluff-start-card').isDisabled());
  await host.locator('[data-action="end"]').click();await host.getByText('Endplatzierung',{exact:true}).waitFor();await host.getByRole('link',{name:'Quiz Studio',exact:true}).last().click();
  await host.locator('[data-closer-action="start"]').click();await host.waitForURL('**/closer/live.html?session=*');await host.locator('[data-action="participation"]').click();await host.locator('.bluff-qr img').waitFor();
  const qr=await host.locator('.bluff-qr canvas').evaluate(c=>({w:c.width,h:c.height,data:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}));const decoded=require('jsqr')(new Uint8ClampedArray(qr.data),qr.w,qr.h);assert(decoded);const join=new URL(decoded.data);assert.equal(join.searchParams.get('kind'),'closer');await host.keyboard.press('Escape');
  const players=[];
  for(const name of ['Ada','Ben','Cleo']){const p=await page(false,{width:390,height:844});players.push(p);await p.goto(join.href);await p.waitForURL('**/closer/student.html?code=*');await p.locator('#playerName').fill(name);await p.locator('#joinForm [type="submit"]').click();await p.getByText('Wartelobby',{exact:true}).waitFor();assert.equal(await p.locator('.app-nav,.studio-header,a[href]').count(),0);}
  await host.locator('.bluff-score').filter({hasText:'Cleo'}).waitFor();await shot(host,'lobby-desktop');await shot(players[0],'waiting-mobile');
  await host.locator('[data-action="start"]').click();for(const p of players)await p.locator('#guessValue').waitFor();
  assert.equal(await players[0].locator('.closer-unit').innerText(),'Seiten');
  // Guesses: words are rejected, German decimals work, a guess can be changed until the reveal.
  await players[0].locator('#guessValue').fill('neunzig');await players[0].locator('#sendGuess').click();await players[0].getByText('Gib deinen Tipp als Zahl ein, z. B. 150 oder 2,5.',{exact:true}).waitFor();
  await players[0].locator('#guessValue').fill('90');await players[0].locator('#sendGuess').click();await players[0].getByText('✓ Dein Tipp: 90 Seiten · bis zur Auflösung änderbar.',{exact:true}).waitFor();
  await players[0].locator('#guessValue').fill('99,5');await players[0].locator('#sendGuess').click();await players[0].getByText('✓ Dein Tipp: 99,5 Seiten · bis zur Auflösung änderbar.',{exact:true}).waitFor();
  await players[0].reload();await players[0].getByText('✓ Dein Tipp: 99,5 Seiten · bis zur Auflösung änderbar.',{exact:true}).waitFor();
  // A half-typed guess survives refreshes caused by other players' guesses.
  await players[2].locator('#guessValue').fill('13');
  await players[1].locator('#guessValue').fill('120');await players[1].locator('#sendGuess').click();await players[1].getByText(/✓ Dein Tipp: 120 Seiten/).waitFor();
  await players[2].waitForFunction(()=>window.__payloads.filter(x=>x.name==='closer_player_state').some(x=>x.payload.data?.players?.filter(p=>p.guessed).length===2));
  await players[2].waitForTimeout(300);assert.equal(await players[2].locator('#guessValue').inputValue(),'13');
  await players[2].locator('#guessValue').fill('100');await players[2].locator('#sendGuess').click();await players[2].getByText(/✓ Dein Tipp: 100 Seiten/).waitFor();
  await host.waitForFunction(()=>window.__payloads.some(x=>x.name==='closer_host_state'&&x.payload.data?.phase==='guess'&&x.payload.data.players.every(p=>p.guessed)));
  await host.locator('.bluff-score.has-answer').nth(2).waitFor();
  // Before the reveal nobody receives the answer or other guesses, not even the projected board.
  for(const p of [host,...players])assert(await p.evaluate(()=>window.__payloads.filter(x=>/closer_(host|player)_state/.test(x.name)&&x.payload.data?.phase==='guess').every(x=>x.payload.data.answer===null&&x.payload.data.results.length===0)),'Answer hidden before the reveal');
  assert.equal(await host.locator('.closer-answer,.closer-line').count(),0);
  assert.equal(await host.locator('[data-action="reveal"]').evaluate(b=>getComputedStyle(b).backgroundColor),green,'The flow action uses the shared primary button');
  await shot(host,'guess-desktop');await shot(players[0],'guess-mobile');
  await host.locator('[data-action="reveal"]').click();await host.locator('.closer-line').waitFor();
  assert.equal(await host.locator('.closer-answer strong').innerText(),'100 Seiten');
  // Sorted by distance: Cleo exact (3), Ada 0,5 off (2), Ben 20 off (1).
  assert.deepEqual(await host.locator('.closer-result-name').allTextContents(),['Cleo','Ada','Ben']);
  assert.deepEqual(await host.locator('.closer-result-points').allTextContents(),['+3 P','+2 P','+1 P']);
  assert.deepEqual(await host.locator('.closer-result-distance').allTextContents(),['genau getroffen','± 0,5','± 20']);
  assert.equal(await host.locator('.closer-dot').count(),3);
  const line=await host.locator('.closer-line').evaluate(el=>{const box=el.getBoundingClientRect(),t=el.querySelector('.closer-target').getBoundingClientRect(),dots=[...el.querySelectorAll('.closer-dot')].map(d=>d.getBoundingClientRect());return {inside:dots.concat(t).every(r=>r.left>=box.left-10&&r.right<=box.right+10),order:dots.map(d=>d.left+d.width/2)};});
  assert(line.inside,'All markers stay on the number line');assert(line.order[2]>line.order[0],'Higher guesses sit further right');
  await players[0].locator('.closer-line').waitFor();assert.equal(await players[0].locator('.closer-dot.is-own').count(),1);assert.equal(await players[0].locator('.closer-result.me').innerText().then(t=>t.includes('Ada')),true);
  assert.equal(await players[0].locator('.ranking-panel').evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(255, 102, 0)','Rankings are orange');
  await shot(host,'reveal-desktop');await shot(players[0],'reveal-mobile');
  await host.setViewportSize({width:390,height:844});await shot(host,'reveal-host-mobile');await host.setViewportSize({width:1280,height:900});
  assert.equal(await host.locator('.bluff-score').first().locator('b').innerText(),'3 P');
  // Second round: one guess on a decimal answer, then the final placement.
  await host.locator('[data-action="next"]').click();for(const p of [players[0],players[1]])await p.locator('#guessValue').waitFor();
  assert.equal(await players[0].locator('#guessValue').inputValue(),'','A new round starts with an empty field');
  await players[1].locator('#guessValue').fill('12');await players[1].locator('#sendGuess').click();await players[1].getByText(/✓ Dein Tipp: 12 m/).waitFor();
  await host.waitForFunction(()=>window.__payloads.some(x=>x.name==='closer_host_state'&&x.payload.data?.round_index===1&&x.payload.data.players.some(p=>p.guessed)));
  await host.locator('[data-action="reveal"]').click();await host.locator('.closer-answer').waitFor();assert.equal(await host.locator('.closer-answer strong').innerText(),'12,5 m');
  assert.equal(await host.locator('[data-action="next"]').innerText(),'Endplatzierung anzeigen');
  await host.locator('[data-action="next"]').click();await host.getByText('Endplatzierung',{exact:true}).waitFor();
  assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score b').allTextContents(),['4 P','3 P','2 P']);
  assert.deepEqual(await host.locator('.bluff-final-ranking .bluff-score .bluff-score-name').allTextContents(),['Ben','Cleo','Ada']);
  await shot(host,'final-desktop');await players[0].getByText('Endplatzierung',{exact:true}).waitFor();await shot(players[0],'final-mobile');
  assert.deepEqual(errors,[]);console.log('PASS: dashboard tile, catalogue with German decimals, saved/random games, decoded QR entry, hidden answers, changeable guesses, kept drafts, number line, scoring and final placement');
 }catch(e){for(const c of contexts)for(const p of c.pages()){console.error('Page:',p.url(),await p.locator('#appMessage,[data-closer-status],#cloudStatus').allTextContents());await p.screenshot({path:path.join(output,'closer-failure-'+contexts.indexOf(c)+'.png'),fullPage:true}).catch(()=>{});}throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
