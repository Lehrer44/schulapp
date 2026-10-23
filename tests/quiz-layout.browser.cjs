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
 window.__fixture={quiz,session,rows:[],saved:null};
 window.__client={auth:{getUser:async()=>({data:{user:{id:owner}}})},channel(){return {on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this;}}},removeChannel(){},from(){return {select(){return this},eq(){return this},single:async()=>({data:structuredClone(session)}),maybeSingle:async()=>({data:{revision:1,payload:{quizzes:[quiz]}}})};},rpc:async(name,args)=>{
  if(name==='save_teacher_library'){window.__fixture.saved=structuredClone(args.p_payload);return {data:{ok:true,revision:2}};}
  if(name==='quiz_live_teacher_state')return {data:{ok:true,session:structuredClone(session),leaderboard:people.map((p,i)=>({participant:p,score:session.question_states[session.current_index]?.revealed?(i===0?3:0):0,answered:window.__fixture.rows.some(r=>r.participant_id===p.id)})),responses:window.__fixture.rows.map(r=>session.question_states[session.current_index]?.revealed?r:{...r,answer:null,is_correct:null,awarded_points:0})}};
  if(name==='quiz_live_start'){session.current_index=0;session.status='running';session.updated_at=crypto.randomUUID();}
  if(name==='quiz_live_reveal_question'){session.question_states[session.current_index].revealed=true;session.question_states[session.current_index].locked=true;session.updated_at=crypto.randomUUID();}
  return {data:{ok:true}};
 }};
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fs.mkdirSync(out,{recursive:true});
 const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{for(const width of [390,1280]){
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
  const box=await page.locator('.lobby-panel').boundingBox(),button=await page.locator('[data-action="start"]').boundingBox();
  assert(Math.abs((box.x+box.width/2)-(button.x+button.width/2))<2);assert(Math.abs((box.y+box.height/2)-(button.y+button.height/2))<2);
  await page.screenshot({path:path.join(out,'live-quiz-lobby-'+width+'.png'),fullPage:true});
  await page.locator('[data-action="start"]').click();await page.locator('.question-panel').waitFor();
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
  assert.deepEqual(errors,[]);await ctx.close();
  console.log('PASS: compact editor headers, question-only formatting, plain answers, lobby, all six revealed views, hidden answers and coloured names at '+width+'px');
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
