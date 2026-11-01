// Render the actual applications offline; fixture RPCs never contact Supabase.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');let body=fs.readFileSync(file,'utf8');if(file.endsWith('.html'))body=body.replace(/<script[^>]+src="https:\/\/[^"]*supabase[^"]*"[^>]*><\/script>/gi,'<script>window.supabase={createClient:()=>window.__layoutClient};</script>');res.end(body);}catch{res.writeHead(404);res.end();}
});
function fixtures(){
 sessionStorage.clear();
 const params=new URLSearchParams(location.search),active=params.get('fixture')==='active',phase=params.get('phase')||'question';
 const owner='00000000-0000-4000-8000-000000000001',title='Gemeinsam lernen: Physik und Mathematik im Unterricht';
 const quiz={id:'layout-quiz',title,questions:[{id:'q1',type:'shortanswer',text:'Wie verändert sich die Geschwindigkeit bei einer gleichmäßigen Beschleunigung?',points:5,answers:['gleichmäßig']}]};
 const game={id:'layout-game',name:title,rows:4,cols:4,cells:{'0,0':{type:'text',text:'Beschreibe ein Beispiel für eine beschleunigte Bewegung.',answer:'Eine anfahrende Straßenbahn.'}}};
 const slides=[{type:'Multiple-Choice',question:'Welche Aussage beschreibt die Bewegung?',options:['Die Geschwindigkeit steigt.','Die Geschwindigkeit bleibt gleich.']}];
 const survey={id:'survey-session',owner_id:owner,name:title,title,slides,survey_snapshot:slides,current_slide:0,status:'running',join_code:'ABCDE',updated_at:'initial'};
 const qs={id:'quiz-session',owner_id:owner,quiz_title:title,quiz_snapshot:quiz,current_index:0,status:'running',join_code:'ABCDE',question_states:[{locked:false,revealed:false,mode:'classic'}],updated_at:'initial'};
 const players=[{id:'player',name:'Alexandra mit einem längeren Namen',score:3,ready:true,submitted:false},{id:'other',name:'Ben',score:1,ready:true,submitted:false}];
 const bluff={ok:true,session_id:'room',join_code:'ABCDE',phase,round_index:0,round_count:3,revision:1,reveal_count:phase==='leaderboard'?2:0,deadline:null,server_now:new Date().toISOString(),question:'Wozu wird die Energie beim Bremsen umgewandelt?',players,options:['answers','vote','leaderboard'].includes(phase)?[{id:'o1',answer:'WÄRME DURCH DIE REIBUNG ZWISCHEN DEN BREMSBELÄGEN UND DEM RAD',own:false,revealed:phase==='leaderboard',is_truth:phase==='leaderboard',authors:[],voters:[players[0],players[1]]},{id:'o2',answer:'LICHT',own:true,revealed:phase==='leaderboard',is_truth:false,authors:[players[0],players[1]],voters:[]}]:[],entries:[],own_entry:null,own_vote:null};
 const yn={ok:true,session_id:'room',title,join_code:'ABCDE',phase,round_index:0,round_count:3,revision:1,deadline:new Date(Date.now()+60000).toISOString(),server_now:new Date().toISOString(),question:'Fährst du regelmäßig mit dem Fahrrad zur Schule?',players,player_count:2,seconds:60,exact_points:3,near_points:1,tolerance:1,reveal_answers:false,own_answer:null,yes_count:1,no_count:1,results:players.map(p=>({...p,estimate:1,points:3,exact:true}))};
 if(active){
  const credentials={session:'room',player:'player',token:'a'.repeat(64),name:players[0].name,code:'ABCDE'};
  sessionStorage.setItem('bluff.credentials.v1',JSON.stringify(credentials));
  sessionStorage.setItem('yesno.credentials.v1:ABCDE',JSON.stringify(credentials));
 }
 const result=data=>Promise.resolve({data,error:null});
 const client={
  auth:{getUser:async()=>({data:{user:{id:owner}},error:null}),getSession:()=>result({session:null}),signOut:()=>result({})},
  channel(){return {on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this}}},removeChannel(){},
  storage:{from(){return {download:async()=>({error:{statusCode:'404',message:'Object not found'}})}}},
  from(table){let kind;const data=()=>table==='teacher_libraries'?{revision:1,payload:kind==='quiz'?{quizzes:[quiz]}:{games:[game]}}:table==='surveys'?survey:table==='sessions'?survey:table==='quiz_live_sessions'?qs:table==='jeopardy_catalog'?{payload:{games:[game]}}:[];
   return {select(){return this},eq(k,v){if(k==='kind')kind=v;return this},in(){return this},order(){return this},range(){return this},maybeSingle:()=>result(data()),single:()=>result(data()),then(resolve,reject){return result(table==='surveys'?[survey]:[]).then(resolve,reject)}};
  },
  rpc(name,args){
   if(name==='bluff_quiz_list')return result({ok:true,quizzes:[]});
   if(name==='yesno_game_list')return result({ok:true,games:[],sessions:[]});
   if(name.endsWith('question_list'))return result({ok:true,questions:[{id:1,question:'Wie viel Energie wird bei dieser Bewegung umgewandelt?',correct_answer:'WÄRME',pack:'Alltag',category:'Physik'}]});
   if(name==='bluff_host_state'||name==='bluff_player_state')return result(bluff);
   if(name==='bluff_vote'){bluff.own_vote=args.p_option_id;players[0].voted=true;bluff.revision++;return result({ok:true});}
   if(name==='yesno_host_state'||name==='yesno_player_state')return result(yn);
   if(name==='quiz_live_teacher_state')return result({ok:true,session:qs,leaderboard:players.map(p=>({participant:p,score:p.score,answered:false})),responses:[]});
   if(name==='classroom_join')return result({ok:true,session_id:'survey-session',participant_id:'player',join_code:'ABCDE'});
   if(name==='survey_student_state_compact')return result({ok:true,session:survey,response:null});
   if(name==='quiz_live_student_state_secure')return result({ok:true,status:'running',title,current_index:0,question_count:1,question:{type:'shortanswer',points:5},question_state:qs.question_states[0],play_mode:'classic',round_open:true,locked:false,revealed:false,leaderboard:players,own_response:null});
   return result({ok:true,revision:2});
  }
 };
 window.__layoutClient=client;window.supabase={createClient:()=>client};
 window.__layout={quiz,game,survey};
}
const views=[
 ['hub','index.html','#teacherApps'],['login','login.html','.login'],['join','join.html','main'],
 ['survey-library','apps/umfrage/index.html','#surveyPanel'],['survey-editor','apps/umfrage/editor.html?id=survey-session','.previewStage'],['survey-live','apps/umfrage/live.html?id=survey-session','#liveQuestion'],
 ['survey-join','apps/umfrage/student.html?code=ABCDE','#joinBtn'],
 ['survey-player','apps/umfrage/student.html?code=ABCDE','#joinBtn',async p=>{await p.locator('#name').fill('Alex');await p.locator('#joinBtn').click();await p.locator('#submitBtn').waitFor({state:'visible'});}],
 ['quiz-library','apps/quiz-studio/index.html','#yesnoLibrary'],
 ['quiz-editor','apps/quiz-studio/index.html','#classicLibrary',p=>p.evaluate(()=>{state.draft=deepCopy(db.quizzes[0]);state.view='editor';render();})],
 ['quiz-preview','apps/quiz-studio/index.html','#classicLibrary',p=>p.evaluate(()=>startPlay(db.quizzes[0].id))],
 ['quiz-result','apps/quiz-studio/index.html','#classicLibrary',p=>p.evaluate(()=>{startPlay(db.quizzes[0].id);state.session.results=[{score:5,correct:true}];state.view='result';render();})],
 ['quiz-live','apps/quiz-studio/live.html?session=quiz-session','.question-toolbar'],
 ['quiz-join','apps/quiz-studio/student.html?code=ABCDE','#joinForm'],
 ['quiz-player','apps/quiz-studio/student.html?code=ABCDE','#joinForm',async p=>{await p.locator('#studentName').fill('Alex');await p.locator('#joinForm button').click();await p.locator('#submitAnswer').waitFor();}],
 ['jeopardy-library','apps/jeopardy/index.html','.game-card'],
 ['jeopardy-editor','apps/jeopardy/index.html','.game-card',p=>p.evaluate(()=>{current=normalizeGame(window.__layout.game);editMode=true;renderBoard();})],
 ['jeopardy-game','apps/jeopardy/index.html','.game-card',p=>p.evaluate(()=>{current=normalizeGame(window.__layout.game);editMode=false;teams=[{name:'Team 1',score:0},{name:'Team 2',score:0}];renderBoard();})],
 ['jeopardy-question','apps/jeopardy/index.html','.game-card',p=>p.evaluate(()=>{current=normalizeGame(window.__layout.game);editMode=false;teams=[{name:'Team 1',score:0},{name:'Team 2',score:0}];renderBoard();openCell(0,0);})],
 ['bluff-library','apps/quiz-studio/bluff/index.html','#questionRows'],
 ['bluff-editor','apps/quiz-studio/bluff/index.html','#questionRows',async p=>{await p.locator('[data-action="new-question"]').click();}],
 ['bluff-join','apps/quiz-studio/bluff/student.html','#joinForm'],
 ['yesno-library','apps/quiz-studio/yesno/index.html','#ynQuestionRows'],
 ['yesno-editor','apps/quiz-studio/yesno/index.html','#ynQuestionRows',async p=>{await p.locator('[data-action="new-question"]').click();}],
 ['yesno-join','apps/quiz-studio/yesno/student.html','#ynJoinForm'],
];
for(const format of ['bluff','yesno'])for(const mode of ['host','player'])for(const phase of format==='bluff'?['lobby','bluff','answers','vote','leaderboard','ended']:['lobby','question','result','finished']){
 views.push([`${format}-${mode}-${phase}`,`apps/quiz-studio/${format}/${mode==='host'?'live':'student'}.html?session=room&code=ABCDE&fixture=active&phase=${phase}`,format==='bluff'?(phase==='ended'?'.bluff-final-ranking':'.ranking-panel'):phase==='lobby'?'.yn-lobby-grid':'.yn-grid']);
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [360,390,768,1280]){
   const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
   await context.addInitScript(fixtures);
   await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({contentType:'text/javascript',body:''}));
   const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const [name,url,ready,setup] of views){
    errors=[];
    try{
     await page.goto(`http://127.0.0.1:${server.address().port}/${url}`);await page.locator(ready).first().waitFor({state:'visible',timeout:10000});
     if(setup)await setup(page);
     if(/^yesno-(host|player)-/.test(name)){
      const host=name.startsWith('yesno-host-'),question=name.endsWith('-question');
      assert.equal(await page.locator('.studio-header').count(),host?1:0,'Only the host sees the game header');
      if(host)assert.equal(await page.locator('.studio-title').innerText(),'Ja oder Nein');
      assert.equal(await page.getByRole('heading',{name:'Rangliste',exact:true}).count(),1,'Every phase has the shared ranking');
      assert.equal(await page.getByRole('heading',{name:'Punktestand',exact:true}).count(),0);
      assert.equal(await page.locator('.yn-player').count(),0,'No separate participant chips under the question');
      if(!host){
       assert.equal(await page.locator('h1').count(),0);
       if(!question)assert.equal(await page.locator('.yn-question').count(),0,'Player results omit the question');
       assert.equal(await page.getByText(/Bitte wählen|Erst beide Eingaben auswählen|0 bis \d+ Personen|Persönliche Ja\/Nein-Antworten werden nicht veröffentlicht\.|Die Spielleitung startet die nächste Runde\./).count(),0);
       if(!name.endsWith('-lobby'))assert(await page.locator('.yn-grid').evaluate(el=>el.lastElementChild.getBoundingClientRect().top>=el.firstElementChild.getBoundingClientRect().bottom),'Player ranking stays below the game card');
      }
     }
     if(name.startsWith('bluff-')){
      assert.equal(await page.getByText(/haben eine Antwort eingegeben|Anonyme Antwort \d|haben abgestimmt|Punkte vergeben|Gewählt von|Keine Stimmen/).count(),0,'Removed phase helper text');
      for(const card of await page.locator('.manipulation-option').all()){
       const centered=await card.evaluate(el=>{
        const row=el.getBoundingClientRect(),title=el.querySelector('h3').getBoundingClientRect(),authors=el.querySelector('.bluff-authors')?.getBoundingClientRect();
        return Math.abs((title.top-row.top)-(row.bottom-(authors?.bottom??title.bottom)))<2;
       });
       assert(centered,'Answer and its authors are vertically centered in '+name+' at '+width);
      }
     }
     if(name==='bluff-host-leaderboard'||name==='bluff-player-leaderboard'){
      const styles=await page.locator('.bluff-author').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.color,s.fontSize,s.padding,s.borderRadius];}));
      assert.equal(styles.length,2);assert.deepEqual(styles[0],styles[1],'Authors use uniform name badges');
      assert.equal(styles[0][0],'rgb(49, 89, 148)');assert.equal(await page.locator('.manipulation-option .bluff-avatar').count(),0);
      for(const badge of await page.locator('.bluff-author').all()){
       assert(await badge.evaluate(el=>{
        const outer=el.getBoundingClientRect(),text=el.firstElementChild.getBoundingClientRect();
        return outer.height>=28&&text.top>outer.top&&text.bottom<outer.bottom&&Math.abs((text.top+text.bottom-outer.top-outer.bottom)/2)<=1.1&&el.scrollHeight<=el.clientHeight;
       }),'Short and wrapped names stay centered and unclipped inside their blue fields');
      }
      for(const votes of await page.locator('.manipulation-option .bluff-voters').all()){
       assert.equal(await votes.evaluate(el=>getComputedStyle(el).borderLeftWidth),'1px','Keep divider even without votes');
      }
      for(const voter of await page.locator('.bluff-voter').all()){
       assert.deepEqual(await voter.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.backgroundColor,s.borderWidth,s.padding];}),['14px','400','rgba(0, 0, 0, 0)','0px','0px'],'Voters are plain names');
      }
     }
     if(name==='bluff-player-vote'){
      const own=page.locator('[data-option-id="o2"]');
      assert.equal((await own.innerText()).trim(),'LICHT');assert.equal(await own.locator('input,button,label,p').count(),0,'Own answer contains only the answer');
      const choice=page.getByRole('radio');assert.equal(await choice.count(),1);
      const answer=await page.locator('[data-option-id="o1"] .bluff-option-answer').boundingBox(),control=await page.locator('.bluff-vote-control').boundingBox();
      assert(control.x>=answer.x+answer.width,'Choice stays to the right of a wrapped answer');
      assert(control.y<answer.y+answer.height&&control.y+control.height>answer.y,'Choice aligns vertically with the answer');
      assert(control.width>=44&&control.height>=44,'Choice has a touch-sized target');
      await choice.focus();await page.keyboard.press('Space');
      await page.waitForFunction(()=>document.querySelector('input[data-action="vote"]')?.checked&&document.querySelector('input[data-action="vote"]').disabled);
      assert.equal(await choice.isChecked(),true);assert.equal(await choice.isDisabled(),true);
      assert.equal((await own.innerText()).trim(),'LICHT','Own answer stays free of vote comments');
     }
     if(name==='bluff-player-ended')assert.equal(await page.locator('.bluff-final-ranking .bluff-score.me').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(217, 239, 223)');
     await page.evaluate(()=>document.fonts.ready);
     const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
     assert(overflow.width<=width+1,`${name} at ${width}: page overflow ${overflow.width}`);
     assert(await page.evaluate(()=>{const status=document.querySelector('#bluffConnectionStatus,#connectionStatus'),app=document.querySelector('main');return !status||!status.getClientRects().length||!app||status.getBoundingClientRect().top>=app.getBoundingClientRect().bottom-1;}),`${name} at ${width}: connection status must follow the app`);
     // Measure computed styles of the rendered pages; catches local CSS overriding the shared scale.
     for(const panel of await page.locator('.panel:visible').all()){
      if(await panel.evaluate(el=>el.closest('.play-screen,.board-wrap')!==null))continue;
      const padding=await panel.evaluate(el=>Math.max(...['Top','Right','Bottom','Left'].map(side=>parseFloat(getComputedStyle(el)['padding'+side]))));
      assert(padding<=16,`${name} at ${width}: panel padding ${padding}`);
     }
     for(const header of await page.locator('.studio-header:visible').all()){
      const gap=await header.evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom)+parseFloat(getComputedStyle(el).marginBottom));
      assert(gap<=24,`${name}: oversized header gap ${gap}`);
     }
     for(const btn of await page.locator('.studio-actions button:visible,.yn-answer:visible,.yn-submit:visible,.rank-choice button:visible').all())assert((await btn.boundingBox()).height>=43,`${name}: control shrank`);
     assert.deepEqual(errors,[],name+' script errors');
     if(width===390||width===1280)await page.screenshot({path:path.join(output,`layout-${name}-${width}.png`),fullPage:!name.startsWith('jeopardy-')});
    }catch(e){console.error('VIEW FAILURE',name,width,'script errors:',errors,'auth:',await page.evaluate(async()=>({url:location.href,auth:await window.__layoutClient?.auth.getUser()})),'page:',await page.locator('body').innerText());await page.screenshot({path:path.join(output,`layout-FAILED-${name}-${width}.png`),fullPage:true});throw e;}
   }
   await context.close();console.log(`PASS: ${views.length} real application views at ${width}px`);
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
