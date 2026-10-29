// Actual editor/live pages, synthetic sessions, no production Supabase access.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
function fixture(){
 const owner='00000000-0000-4000-8000-000000000001';
 const c=document.createElement('canvas');c.width=400;c.height=200;c.getContext('2d').fillRect(0,0,400,200);
 const options=[{id:'a',text:'Antwort A',correct:true,textFormat:{ranges:[{start:0,end:7,bold:true}]}},{id:'b',text:'Antwort B',correct:false}];
 const quiz={id:'quiz',title:'Ein Quizname, der in der Lobby verborgen bleibt',description:'Bestehende Beschreibung',shuffleQuestions:true,shuffleAnswers:true,immediateFeedback:false,questions:[
  {id:'q0',type:'single',text:'Wähle eine Antwort.',points:3,options:structuredClone(options),playMode:'classic'},
  {id:'q1',type:'multiple',text:'Wähle alle passenden Antworten.',points:3,options:structuredClone(options),playMode:'classic'},
  {id:'q2',type:'truefalse',text:'Die Aussage stimmt.',points:3,correct:true,playMode:'classic'},
  {id:'q3',type:'ranking',text:'Ordne die Schritte.',points:3,items:[{id:'i1',text:'Erstens'},{id:'i2',text:'Zweitens'},{id:'i3',text:'Drittens'}],playMode:'classic'},
  {id:'q4',type:'shortanswer',text:'Nenne das Ergebnis.',points:3,answers:['4'],playMode:'classic'},
  {id:'q5',type:'pin',text:'Setze den Pin.',points:3,media:{type:'image',data:c.toDataURL(),name:'Karte.png'},pinAspect:2,pinTarget:{x:50,y:50,radius:10}}
 ]};
 const people=[{id:'p1',name:'Ada'},{id:'p2',name:'Ben <img src=x>'}];
 const session={id:'session',owner_id:owner,quiz_title:quiz.title,quiz_snapshot:structuredClone(quiz),status:'lobby',current_index:-1,join_code:'ABCDE',question_states:quiz.questions.map(()=>({mode:'classic',locked:false,revealed:false})),updated_at:'initial'};
 window.__fixture={quiz,session,rows:[],saved:null,playerState:{ok:true,status:'running',title:quiz.title,current_index:0,question_count:6,question:{type:'shortanswer',points:3},question_state:{mode:'classic',locked:false,revealed:false},play_mode:'classic',round_open:true,locked:false,revealed:false,own_response:null,leaderboard:[{name:'Ada',score:3,answered:false}]}};
 window.__client={auth:{getUser:async()=>({data:{user:{id:owner}}})},channel(){return {on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this;}}},removeChannel(){},from(){return {select(){return this},eq(){return this},single:async()=>({data:structuredClone(session)}),maybeSingle:async()=>({data:{revision:1,payload:{quizzes:[quiz]}}})};},rpc:async(name,args)=>{
  if(['quiz_live_teacher_state','quiz_live_student_state_secure'].includes(name)&&(window.__fixture.failSync||!navigator.onLine))return {error:{message:'Testverbindung unterbrochen'}};
  if(name==='save_teacher_library'){window.__fixture.saved=structuredClone(args.p_payload);return {data:{ok:true,revision:2}};}
  if(name==='quiz_live_teacher_state')return {data:{ok:true,session:structuredClone(session),leaderboard:people.map((p,i)=>({participant:p,score:session.question_states[session.current_index]?.revealed?(i===0?3:0):0,answered:window.__fixture.rows.some(r=>r.participant_id===p.id)})),responses:window.__fixture.rows.map(r=>session.question_states[session.current_index]?.revealed?r:{...r,answer:null,is_correct:null,awarded_points:0})}};
  if(name==='classroom_join')return {data:{ok:true,session_id:'session',participant_id:'p1',join_code:'ABCDE'}};
  if(name==='quiz_live_student_state_secure')return {data:structuredClone(window.__fixture.playerState)};
  if(name==='quiz_live_start'){window.__fixture.starts=(window.__fixture.starts||0)+1;session.current_index=0;session.status='running';session.updated_at=crypto.randomUUID();}
  if(name==='quiz_live_reveal_question'){session.question_states[session.current_index].revealed=true;session.question_states[session.current_index].locked=true;session.updated_at=crypto.randomUUID();}
  return {data:{ok:true}};
 }};
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fs.mkdirSync(out,{recursive:true});
 const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 for(const width of [360,390,768,1024,1280,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.addInitScript(fixture);
  await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>window.__client}'}));
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/apps/quiz-studio/index.html');await page.locator('[data-action="open-quiz"]').waitFor();
  await page.evaluate(()=>{
   db.quizzes[0].title='Logik Quiz';db.quizzes.push({...deepCopy(db.quizzes[0]),id:'quiz2',title:'Allgemein Quiz'});
   const original=window.__client.rpc;
   window.__client.rpc=async(name,args)=>{
    if(name==='bluff_quiz_list')return {data:{ok:true,quizzes:[{id:'b1',name:'Probefrage',questions:[{id:1,question:'Test?',correct_answer:'JA'}]}]}};
    if(name==='yesno_game_list')return {data:{ok:true,games:[{id:'y1',name:'Schule',questions:[{id:1,question:'Test?',pack:'Schule'}]}],sessions:[]}};
    if(name.endsWith('question_list'))return {data:{ok:true,questions:[{id:1,question:'Test?',correct_answer:'JA',pack:'Schule'}]}};
    return original(name,args);
   };render();
  });
  await page.locator('[data-bluff-quiz-id]').waitFor();await page.locator('[data-yn-game-id]').waitFor();
  assert.deepEqual(await page.locator('.studio-library-grid>.panel h2').allTextContents(),['Quiz','Manipulation','Wer würde eher','Dieselbe Antwort','Ja oder Nein']);
  const boxes=await page.locator('.studio-library-grid>.panel').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const columns=width>1100?3:width>700?2:1;
  for(let i=0;i<5;i++){
   assert(Math.abs(boxes[i].x-boxes[i%columns].x)<1,'Aligned grid columns');
   if(i<columns)assert(Math.abs(boxes[i].y-boxes[0].y)<1,'Aligned first row');
   else assert(boxes[i].y>=boxes[i-columns].y+boxes[i-columns].height,'Ordered subsequent rows');
  }
  for(const action of await page.locator('.library-heading :is(button,a)').all()){
   assert.equal((await action.innerText()).trim(),'');assert(await action.getAttribute('aria-label'));
   assert(await action.getAttribute('title'));assert.equal(await action.locator('svg').count(),1);
   assert((await action.boundingBox()).height>=(width<=800?44:32));
  }
  for(const [key,folder] of [['bluff','bluff'],['rather','rather'],['same','same'],['yn','yesno']]){
   assert.equal(await page.locator(`[data-${key}-action="random"]`).getAttribute('title'),'Zufälliges Spiel');
   assert.equal(await page.locator(`#${key==='yn'?'yesno':key}Library a`).getAttribute('href'),folder+'/index.html');
   for(const action of ['random','new']){
    await page.locator(`[data-${key}-action="${action}"]`).click();
    await page.locator('dialog[open]').waitFor();
    await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'detached'});
   }
  }
  for(const card of await page.locator('.qzcard').all()){
   const title=await card.locator('h3').boundingBox(),actions=await card.locator('.card-actions').boundingBox();
   assert(title.x+title.width<=actions.x+1,'Title cannot overlap actions');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Grid fits '+width);
  await page.screenshot({path:path.join(out,'studio-grid-'+width+'.png'),fullPage:true});
  await page.locator('.qzcard h3').first().evaluate(el=>el.textContent='EinSehrLangerSpielnameOhneLeerzeichen'.repeat(5));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long title fits '+width);
  assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('PASS: five-tile grid, renamed games, icon actions, dialogs, long titles and touch controls at 360/390/768/1024/1280/1440px');
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.addInitScript(fixture);
  await ctx.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>window.__client}'}));
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/apps/quiz-studio/index.html');await page.locator('[data-action="open-quiz"]').click();
  assert.equal(await page.locator('[data-bind="description"],[data-bind="shuffleQuestions"],[data-bind="shuffleAnswers"],[data-bind="immediateFeedback"]').count(),0);
  assert.equal(await page.locator('.qcard').count(),6);
  for(const card of await page.locator('.qcard').all()){
   assert.equal(await card.locator('.qhead [data-media-input]').count(),1);
   const isPin=(await card.getAttribute('data-qid'))==='q5';
   assert.equal(await card.locator('.qhead [data-field="play-mode"]').count(),isPin?0:1);
   assert.equal(await card.locator('.qbody .rich-toolbar').count(),0);
   assert.equal(await card.locator('.rich-toolbar').count(),1);
   assert.equal(await card.locator('.qbody .hint').count(),0);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Editor fits '+width);
  await page.locator('[data-qid="q0"] [data-field="option-text"]').first().fill('Unformatierte Antwort');
  await page.locator('[data-qid="q3"] [data-field="item-text"]').first().fill('Neuer erster Schritt');
  await page.locator('[data-qid="q3"] [data-field="play-mode"]').selectOption('speed');
  await page.locator('#retryCloudSave').click();
  await page.waitForFunction(()=>window.__fixture.saved?.quizzes[0].questions[0].options[0].text==='Unformatierte Antwort');
  const saved=await page.evaluate(()=>window.__fixture.saved.quizzes[0]);
  assert.equal(saved.questions[0].options[0].textFormat,undefined);assert.equal(saved.questions[3].items[0].text,'Neuer erster Schritt');assert.equal(saved.questions[3].playMode,'speed');
  assert.equal(saved.description,'Bestehende Beschreibung'); // Removing a control does not erase existing content.
  await page.screenshot({path:path.join(out,'studio-editor-compact-'+width+'.png'),fullPage:true});
  await page.locator('[data-action="add-question"][data-type="pin"]').click();
  assert.equal(await page.getByText('Bitte füge ein Bild für die Pin-Frage ein.',{exact:true}).count(),0);
  await page.goto(base+'/apps/quiz-studio/live.html?session=session');await page.locator('[data-action="start"]').waitFor();
  const lobby=await page.locator('#app').innerText();
  for(const text of ['Ein Quizname','Wartelobby','Live-Ranking','Grün markiert','Teilnehmende:','Die erste Frage ist noch verborgen'])assert(!lobby.includes(text));
  assert.equal(await page.locator('header .status-pill').count(),0);
  assert.equal(await page.locator('.lobby-panel button').count(),0);
  assert.equal(await page.locator('button.lobby-panel[data-action="start"]').count(),1);
  assert.equal(await page.locator('.lobby-panel').innerText(),'Quiz starten');
  assert.equal(await page.locator('#connectionStatus').count(),0);
  await page.waitForFunction(()=>document.querySelector('#saveStatus').dataset.state==='ready');
  await page.evaluate(async()=>{window.__fixture.failSync=true;await refresh(true);});
  assert.equal(await page.locator('#saveStatus').getAttribute('data-state'),'error');
  assert.equal(await page.locator('#saveStatus').evaluate(el=>getComputedStyle(el).color),'rgb(162, 54, 40)');
  assert((await page.locator('#saveStatus').innerText()).includes('Synchronisation fehlgeschlagen'));
  await ctx.setOffline(true);await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Offline'));
  await ctx.setOffline(false);
  await page.waitForFunction(()=>document.querySelector('#saveStatus').dataset.state==='error');
  await page.evaluate(async()=>{window.__fixture.failSync=false;await refresh(true);});
  await page.waitForFunction(()=>document.querySelector('#saveStatus').dataset.state==='ready');
  await page.locator('[data-action="access"]').click();
  assert.equal(await page.locator('#joinDialog h2,#joinDialog .muted').count(),0);
  assert.equal(await page.locator('#joinDialog').getAttribute('aria-label'),'Quizteilnahme');
  const codeBox=await page.locator('#accessCode').boundingBox(),qrBox=await page.locator('#qrCode').boundingBox();
  assert(codeBox.y+codeBox.height<=qrBox.y);
  const link=page.getByRole('link',{name:'Teilnahmeseite öffnen',exact:true});
  assert.equal(await link.getAttribute('href'),base+'/join.html?code=ABCDE&kind=quiz');
  assert.equal(await link.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert((await link.boundingBox()).y>=qrBox.y+qrBox.height);
  const popupEvent=page.waitForEvent('popup');await link.click();const popup=await popupEvent;
  await popup.waitForURL('**/join.html?code=ABCDE&kind=quiz');await popup.close();
  assert(page.url().includes('live.html?session=session'));await page.keyboard.press('Escape');
  await page.screenshot({path:path.join(out,'live-quiz-lobby-'+width+'.png'),fullPage:true});
  if(width===390){await page.locator('.lobby-action').focus();await page.keyboard.press('Enter');}
  else await page.locator('.lobby-action').click({position:{x:12,y:12}});
  await page.locator('.question-panel').waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.starts),1);
  assert.equal(await page.locator('header .status-pill,#connectionStatus').count(),0);
  async function setQuestion(index,answers){await page.evaluate(async({index,answers})=>{
   const f=window.__fixture;f.session.current_index=index;f.session.updated_at=crypto.randomUUID();
   f.session.question_states[index]={mode:'classic',locked:false,revealed:false};
   f.rows=answers.map((answer,i)=>({id:'r'+i,participant_id:'p'+(i+1),question_index:index,answer,is_correct:i===0,awarded_points:i===0?3:0}));await refresh(true);
  },{index,answers});}
  for(const [index,answers] of [[0,['a','b']],[1,[['a'],['b']]],[2,[true,false]],[3,[['i1','i2','i3'],['i3','i1','i2']]],[4,['4','5']],[5,[{x:50,y:50},{x:90,y:90}]]]){
   await setQuestion(index,answers);
   assert.equal(await page.locator('.answer-name,.marker-name,.response-row').count(),0,'No answers before reveal');
   if(index===3){
    assert(await page.locator('.ranking-unrevealed').isVisible());
    if(width===1280){const a=await page.locator('.answer-board').nth(0).boundingBox(),b=await page.locator('.answer-board').nth(1).boundingBox();assert(Math.abs(a.y-b.y)<2);}
   }
   await page.locator('[data-action="reveal"]').click();
   assert.equal(await page.getByText('Antworten der Schülerinnen und Schüler',{exact:true}).count(),0);
   if(index===0){
    assert.equal(await page.locator('.response-row').count(),0);
    assert.equal(await page.locator('[data-option-id="a"] .answer-name.correct').innerText(),'Ada');
    assert.equal(await page.locator('[data-option-id="b"] .answer-name.wrong').innerText(),'Ben <img src=x>');
    assert.equal(await page.locator('.answer-names img').count(),0);
    assert.equal(await page.locator('.answer-names').first().evaluate(el=>getComputedStyle(el).justifyContent),'flex-end');
   }else if(index===5){
    assert.equal(await page.locator('.response-row').count(),0);
    assert.equal(await page.locator('.quiz-pin-marker').count(),2);
    assert.equal(await page.locator('.marker-name.correct').innerText(),'Ada');assert.equal(await page.locator('.marker-name.wrong').innerText(),'Ben <img src=x>');
   }else{
    assert.equal(await page.locator('.response-row').count(),2);
    if(index===3){
     assert.deepEqual(await page.locator('.ranking-revealed .answer-label').allTextContents(),['1. Erstens','2. Zweitens','3. Drittens']);
     const a=await page.locator('.answer-board').nth(0).boundingBox(),b=await page.locator('.answer-board').nth(1).boundingBox();assert(b.y>=a.y+a.height);
    }
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Live type '+index+' fits '+width);
   await page.screenshot({path:path.join(out,'live-quiz-integrated-'+index+'-'+width+'.png'),fullPage:true});
  }
  const player=await ctx.newPage();player.on('pageerror',e=>errors.push(e.message));
  await player.goto(base+'/apps/quiz-studio/student.html?code=ABCDE');
  await player.locator('#studentName').fill('Ada');await player.locator('#joinForm button').click();
  await player.locator('#shortAnswer').waitFor();
  assert.equal(await player.locator('header.top,.logo,#headerStatus,#connectionStatus').count(),0);
  assert.equal(await player.getByText('Dein Status',{exact:true}).count(),0);
  assert.equal(await player.getByText('Live-Ranking',{exact:true}).count(),0);
  assert.equal(await player.getByText('Die Punkte werden erst nach der Lösungsanzeige aktualisiert.',{exact:true}).count(),0);
  assert.equal(await player.locator('.side>.panel').count(),1);
  for(const count of [3,80]){
   await player.evaluate(async count=>{window.__fixture.playerState.leaderboard=Array.from({length:count},(_,i)=>({name:i?'Person '+i:'Ada',score:count-i,answered:false}));await refreshState(true);},count);
   assert.equal(await player.locator('.rank-item').count(),count);
   if(width<=740){
    const answerBox=await player.locator('.layout>.main').boundingBox(),rankingBox=await player.locator('.layout>.side').boundingBox();
    assert(rankingBox.y>=answerBox.y+answerBox.height,'Answers precede the complete mobile ranking');
    assert.equal(await player.locator('.side').evaluate(el=>getComputedStyle(el).position),'static');
    assert(await player.locator('.side>.panel').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Ranking adapts to '+count+' players');
    await player.locator('.rank-item').last().scrollIntoViewIfNeeded();
    assert.equal(await player.locator('.side>.panel').evaluate(el=>el.scrollTop),0);
   }
   assert(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await player.screenshot({path:path.join(out,'live-quiz-player-'+width+'.png'),fullPage:true});
  await player.locator('#shortAnswer').fill('Entwurf bleibt erhalten');
  await ctx.setOffline(true);await player.waitForFunction(()=>document.querySelector('#playerSyncStatus').dataset.state==='error');
  assert((await player.locator('#playerSyncStatus').innerText()).includes('Offline'));
  assert.equal(await player.locator('#playerSyncStatus').evaluate(el=>getComputedStyle(el).color),'rgb(162, 54, 40)');
  assert.equal(await player.locator('#shortAnswer').inputValue(),'Entwurf bleibt erhalten');
  await player.evaluate(()=>window.__fixture.failSync=true);await ctx.setOffline(false);
  await player.waitForFunction(()=>document.querySelector('#playerSyncStatus').dataset.state==='error');
  await player.evaluate(async()=>{window.__fixture.failSync=false;await refreshState(true);});
  await player.waitForFunction(()=>document.querySelector('#playerSyncStatus').dataset.state==='ready');
  assert.equal(await player.locator('#playerSyncStatus').innerText(),'Quiz Studio · Antworten werden erst bei der Lösungsanzeige bewertet.');
  assert.equal(await player.locator('#connectionStatus').count(),0);
  for(const [rows,place,points] of [
   [[{name:'Ben',score:12},{name:'Cem',score:9},{name:'Ada',score:9}],2,9],
   [[{name:'Ben',score:0},{name:'Ada',score:0}],1,0]
  ]){
   await player.evaluate(async rows=>{Object.assign(window.__fixture.playerState,{status:'ended',current_index:6,question:null,leaderboard:rows});await refreshState(true);},rows);
   assert.equal(await player.locator('.final-result h1').innerText(),'Das Quiz ist beendet.');
   assert.equal(await player.locator('.final-place').innerText(),'Platz '+place);
   assert.equal(await player.locator('.final-points').innerText(),points+' Punkte');
   assert.equal(await player.locator('.final-result .eyebrow,.final-result p').count(),0);
  }
  await player.screenshot({path:path.join(out,'live-quiz-player-finished-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[]);await ctx.close();
  console.log('PASS: compact editor headers, question-only formatting, plain answers, lobby, all six revealed views, hidden answers and coloured names at '+width+'px');
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
