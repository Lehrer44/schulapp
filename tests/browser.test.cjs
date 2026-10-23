const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const moduleRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(require.resolve('playwright',{paths:[moduleRoot,__dirname].filter(Boolean)}));
const jsQR=require(require.resolve('jsqr',{paths:[moduleRoot,__dirname].filter(Boolean)}));
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-results');fs.mkdirSync(outputRoot,{recursive:true});
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);const name=pathname.startsWith('/SchulApp/')?pathname.slice('/SchulApp'.length):pathname;const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body)}catch{res.writeHead(404);res.end()}});
async function fixtures(){
 window.__calls=[];let signedIn=true;
 const owner='00000000-0000-4000-8000-000000000001';
 const quiz={id:'quiz1',title:'Testquiz',questions:[{id:'q1',type:'shortanswer',text:'Wie viel ist zwei plus zwei?',textFormat:location.pathname.endsWith('/live.html')?{align:'center',ranges:[{start:0,end:8,bold:true}]}:undefined,points:1,answers:['4']},{id:'q2',type:'truefalse',text:'Die Erde ist rund.',points:1,correct:true}]};
 // A separate test tab receives the exact question saved by the rich-text editor.
 const formattedQuestion=location.pathname.endsWith('/quiz-studio/live.html')&&sessionStorage.getItem('test.formattedLiveQuestion');
 if(formattedQuestion)quiz.questions[0]=JSON.parse(formattedQuestion);
 const survey={owner_id:owner,id:'survey-session',title:'Testumfrage',survey_snapshot:[{type:'Pin setzen',question:'Setze einen Punkt auf die Karte.'}],current_slide:0,status:'running',join_code:'AAAAA',updated_at:'2026-10-12T17:00:00Z'};
 const quizSession={id:'quiz-session',owner_id:owner,quiz_title:'Testquiz',quiz_snapshot:quiz,current_index:0,status:'running',join_code:'BBBBB',question_states:[{locked:false,revealed:false},{locked:false,revealed:false}],updated_at:'initial'};
 let surveyAnswer=null,quizAnswer=null;
 window.__testClient={auth:{async getUser(){return {data:{user:signedIn?{id:owner}:null}}},async getSession(){return {data:{session:signedIn?{user:{id:owner}}:null}}},async signOut(){signedIn=false;return {error:null}}},channel(){const c={on(){return c},subscribe(cb){cb('SUBSCRIBED');return c}};return c},removeChannel(){},storage:{from(){return {async download(){return {error:{statusCode:'404',message:'Object not found'}}}}}},from(table){const conditions={};return {select(){return this},order(){return this},in(){return this},range(){return this},then(resolve,reject){return Promise.resolve({data:[],count:0}).then(resolve,reject)},eq(k,v){conditions[k]=v;return this},async maybeSingle(){if(table==='teacher_libraries')return {data:{revision:1,payload:conditions.kind==='quiz'?{quizzes:[quiz]}:{games:[]}}};return {data:survey}},async single(){return {data:table==='jeopardy_catalog'?{payload:{games:[]}}:table==='sessions'?survey:quizSession}}}},async rpc(name,args){if(!navigator.onLine)return {error:{message:'offline'}};window.__calls.push({name,args});
  if(name==='quiz_live_create')return {data:{ok:true,session_id:'quiz-session',title:args.p_quiz.title,join_code:'BBBBB'}};
  if(name==='classroom_resolve_code')return {data:{ok:true,kinds:[args.p_join_code==='AAAAA'?'survey':'quiz']}};
  if(name==='classroom_join')return {data:{ok:true,session_id:args.p_kind==='survey'?'survey-session':'quiz-session',participant_id:'participant',join_code:args.p_join_code}};
  if(name==='survey_student_state_compact'){const state={...survey};if(!args.p_include_snapshot)delete state.survey_snapshot;return {data:{ok:true,session:state,response:surveyAnswer}};}
  if(name==='survey_submit_response'){surveyAnswer={answer:{value:args.p_value}};return {data:{ok:true}}}
  if(name==='quiz_live_student_state_secure')return {data:{ok:true,status:'running',current_index:0,title:'Testquiz',question_count:2,question:window.__formattedStudentQuestion||{type:'shortanswer',points:1},question_state:{locked:false,revealed:false},own_response:quizAnswer,leaderboard:[],locked:false,revealed:false}};
  if(name==='quiz_live_submit_response_secure'){quizAnswer={answer:args.p_answer};return {data:{ok:true}}}
  if(name==='quiz_live_teacher_state')return {data:{ok:true,session:quizSession,leaderboard:[],responses:[]}};
  if(name==='quiz_live_start_timer_at'){assertIndex(args.p_question_index);quizSession.question_states[0].timer_deadline=new Date(Date.now()+30000).toISOString();return {data:{ok:true}}}
  if(name==='quiz_live_lock_question'){assertIndex(args.p_question_index);quizSession.question_states[0].locked=true;quizSession.updated_at='locked';return {data:{ok:true}}}
  if(name==='quiz_live_reveal_question'){quizSession.question_states[0].revealed=true;quizSession.question_states[0].locked=true;quizSession.updated_at='revealed';return {data:{ok:true}}}
  if(name==='quiz_live_navigate_from'){assertIndex(args.p_expected_index);await new Promise(r=>setTimeout(r,100));quizSession.current_index=args.p_target_index;quizSession.updated_at='navigated';return {data:{ok:true}}}
  return {data:{ok:true,revision:2}};
 }};
 function assertIndex(index){if(index!==quizSession.current_index)throw Error('stale index');}
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(fixtures);
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('supabase')?'window.supabase={createClient:()=>window.__testClient}':'window.QRCode={toCanvas:(c,u,o,cb)=>cb(null)}'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Starting an unchanged quiz performs no library write; pending edits must finish first.
 for(const dirty of [false,true]){
  const start=await context.newPage();start.on('pageerror',e=>errors.push(e.message));
  await start.goto(base+'/apps/quiz-studio/index.html');await start.locator('[data-action="live-quiz"]').waitFor();
  await start.evaluate(()=>{
   const original=window.__testClient.rpc;window.__savedTitle=null;
   window.__testClient.rpc=async(name,args)=>{if(name==='save_teacher_library'){await new Promise(r=>setTimeout(r,350));window.__savedTitle=args.p_payload.quizzes[0].title;}return original(name,args);};
   window.addEventListener('pagehide',()=>sessionStorage.setItem('start-check',JSON.stringify({writes:window.__calls.filter(c=>c.name==='save_teacher_library').length,title:window.__savedTitle})));
  });
  if(dirty){await start.locator('[data-action="open-quiz"]').click();await start.locator('[data-bind="title"]').fill('Aktuell gespeichert');await start.locator('[data-action="back-to-list"]').click();}
  await start.locator('[data-action="live-quiz"]').click();await start.waitForURL('**/live.html?session=quiz-session');
  const result=await start.evaluate(()=>JSON.parse(sessionStorage.getItem('start-check')));assert.equal(result.writes,dirty?1:0);assert.equal(result.title,dirty?'Aktuell gespeichert':null);
  await start.close();
 }
 // The three library cards share controls and report synchronization only in the footer.
 for(const width of [390,1280]){
  const controls=await context.newPage();controls.on('pageerror',e=>errors.push(e.message));
  await controls.setViewportSize({width,height:900});
  await controls.goto(base+'/apps/quiz-studio/index.html');
  await controls.waitForFunction(()=>document.querySelector('#cloudStatus').dataset.state==='ready');
  await controls.evaluate(()=>{
   const original=window.__testClient.rpc;
   window.__testClient.rpc=async(name,args)=>{
    if(name==='save_teacher_library'&&window.__failSave)return {error:{message:'Speicherverbindung unterbrochen'}};
    if(name==='bluff_quiz_list')return window.__failLibrary==='bluff'?{error:{message:'Bluff nicht erreichbar'}}:{data:{ok:true,quizzes:[{id:'b1',name:'Bluff-Test',questions:[{id:1,question:'Test?'}]}]}};
    if(name==='yesno_game_list')return window.__failLibrary==='yesno'?{error:{message:'Ja/Nein nicht erreichbar'}}:{data:{ok:true,games:[{id:'y1',name:'Ja/Nein-Test',questions:[{id:1,question:'Test?',pack:'Test'}]}],sessions:[]}};
    return original(name,args);
   };
   render();
  });
  await controls.locator('[data-bluff-quiz-id]').waitFor();await controls.locator('[data-yn-game-id]').waitFor();
  assert.equal(await controls.locator('.library-count,[data-bluff-count],[data-yn-count],#connectionStatus,[data-action="import"],[data-action^="export"]').count(),0);
  assert.equal(await controls.evaluate(()=>typeof importData),'undefined');
  const cards=controls.locator('#classicLibrary .qzcard,#bluffLibrary .qzcard,#yesnoLibrary .qzcard');
  assert.equal(await cards.count(),3);
  for(const card of await cards.all()){
   const buttons=card.locator('.card-actions button');
   assert.equal(await buttons.nth(0).innerText(),'Starten');
   assert.equal(await buttons.nth(1).innerText(),'');assert.equal(await buttons.nth(2).innerText(),'');
   assert.equal(await buttons.nth(1).locator('svg path').count(),1);assert.equal(await buttons.nth(2).locator('svg path').count(),1);
   assert(await buttons.nth(1).getAttribute('aria-label'));assert(await buttons.nth(2).getAttribute('aria-label'));
   const colours=await buttons.evaluateAll(els=>els.slice(0,2).map(el=>[getComputedStyle(el).color,getComputedStyle(el).backgroundColor]));
   assert.deepEqual(colours[0],colours[1]);
  }
  assert.equal(await controls.locator('.studio-title').evaluate(el=>getComputedStyle(el).fontSize),width===390?'20px':'24px');
  assert(await controls.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await controls.screenshot({path:path.join(outputRoot,'studio-controls-'+width+'.png'),fullPage:true});
  await context.setOffline(true);
  await controls.waitForFunction(()=>document.querySelector('#cloudStatus').dataset.state==='error');
  assert((await controls.locator('#cloudStatus').innerText()).includes('Offline'));
  assert.equal(await controls.locator('#cloudStatus').evaluate(el=>getComputedStyle(el).color),'rgb(162, 54, 40)');
  assert.equal(await controls.locator('#connectionStatus').count(),0);
  await context.setOffline(false);
  // Coming online alone must not claim synchronization succeeded.
  await controls.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('Verbindung wieder verfügbar'));
  assert.equal(await controls.locator('#cloudStatus').getAttribute('data-state'),'error');
  await controls.locator('[data-action="open-quiz"] svg').click();
  assert.equal(await controls.locator('[data-action^="export"]').count(),0);
  await controls.evaluate(()=>window.__failSave=true);
  await controls.locator('[data-bind="title"]').fill('Ungespeicherter Stand');
  await controls.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('Nicht gespeichert'));
  assert.equal(await controls.locator('#cloudStatus').getAttribute('data-state'),'error');
  await controls.screenshot({path:path.join(outputRoot,'studio-sync-error-'+width+'.png'),fullPage:true});
  await controls.evaluate(()=>window.__failSave=false);
  await controls.locator('#retryCloudSave').click();
  await controls.waitForFunction(()=>document.querySelector('#cloudStatus').textContent==='Quiz Studio · Mit Supabase synchronisiert');
  assert.equal(await controls.locator('#cloudStatus').getAttribute('data-state'),'ready');
  await controls.locator('[data-action="back-to-list"]').click();
  // A successful classic save cannot hide an error in another library.
  for(const kind of ['bluff','yesno']){
   await controls.evaluate(kind=>{window.__failLibrary=kind;render();},kind);
   const retry=controls.locator(kind==='bluff'?'[data-bluff-action="retry"]':'[data-yn-action="retry"]');
   await retry.waitFor();
   await controls.waitForFunction(()=>document.querySelector('#cloudStatus').dataset.state==='error');
   assert((await controls.locator('#cloudStatus').innerText()).includes(kind==='bluff'?'Bluff':'Ja/Nein'));
   await controls.evaluate(()=>save());
   assert.equal(await controls.locator('#cloudStatus').getAttribute('data-state'),'error');
   await controls.evaluate(()=>window.__failLibrary=null);
   await retry.click();
   await controls.waitForFunction(()=>document.querySelector('#cloudStatus').dataset.state==='ready');
  }
  await controls.close();
 }
 console.log('PASS: consistent quiz/bluff/yesno controls, removed import/export and counts, compact titles, footer-only errors, offline/save failures and confirmed recovery on desktop/mobile');
 let studioStyle;
 async function checkStudio(name){
  const title=page.locator('.studio-title');await title.waitFor();
  assert.equal((await title.innerText()).replace(/\s+/g,' ').trim(),name+' Studio');
  assert.equal(await page.locator(name==='Quiz'?'#classicLibrary > .library-heading .studio-add':name==='Umfrage'?'#surveyPanel > .panelHeader .studio-primary':'.studio-header .studio-primary').count(),1);
  const style=await page.evaluate(()=>{
   const title=getComputedStyle(document.querySelector('.studio-title')),panel=getComputedStyle(document.querySelector('.panel')),button=getComputedStyle(document.querySelector('#classicLibrary .studio-primary, #surveyPanel .studio-primary, .studio-header .studio-primary'));
   return {headerY:document.querySelector('.studio-header').getBoundingClientRect().y,font:title.fontFamily,size:title.fontSize,weight:title.fontWeight,panelRadius:panel.borderRadius,panelBorder:panel.borderTopWidth,panelBackground:panel.backgroundColor,buttonRadius:button.borderRadius,buttonHeight:button.minHeight};
  });
  const {size,...sharedStyle}=style;
  assert.equal(size,name==='Jeopardy'?'30px':'24px');
  if(studioStyle)assert.deepEqual(sharedStyle,studioStyle);else studioStyle=sharedStyle;
  async function checkLibraryControls(){
   if(name!=='Quiz')return;
   await page.locator('#bluffLibrary .empty').waitFor();
   await page.locator('#yesnoLibrary .empty').waitFor();
   const layout=await page.evaluate(()=>{
    const rect=el=>el.getBoundingClientRect();
    const libraries=[...document.querySelectorAll('#classicLibrary,#bluffLibrary,#yesnoLibrary')];
    const buttons=libraries.flatMap(el=>[...el.querySelectorAll('button,.btn')]);
    return {
     heights:buttons.map(el=>rect(el).height),
     plusOffsets:libraries.map(el=>{
      const button=rect(el.querySelector('.studio-add')),icon=rect(el.querySelector('.studio-add svg'));
      return {x:Math.abs(button.x+button.width/2-icon.x-icon.width/2),y:Math.abs(button.y+button.height/2-icon.y-icon.height/2)};
     }),
     bluffHeight:rect(document.querySelector('#bluffLibrary')).height,
     yesnoHeight:rect(document.querySelector('#yesnoLibrary')).height,
     emptyCards:[...document.querySelectorAll('#bluffLibrary .empty,#yesnoLibrary .empty')].map(el=>({padding:getComputedStyle(el).padding,contentFits:el.scrollHeight<=el.clientHeight+1}))
    };
   });
   assert(layout.heights.every(height=>Math.abs(height-44)<1),'Every library button has the same 44px height');
   assert(layout.plusOffsets.every(offset=>offset.x<1&&offset.y<1),'Add icons are centered on both axes');
   assert.equal(layout.emptyCards[0].padding,layout.emptyCards[1].padding,'Empty libraries use the same spacing');
   assert(layout.emptyCards.every(card=>card.contentFits),'Different-length empty messages remain fully readable without forced equal heights');
  }

  await checkLibraryControls();
  const file=name.toLowerCase();await page.screenshot({path:path.join(outputRoot,'studio-'+file+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),name+' mobile overflow');
  await checkLibraryControls();
  await page.screenshot({path:path.join(outputRoot,'studio-'+file+'-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
 }

 async function captureEditor(name){
  await page.locator('body[data-dashboard-view="editor"]').waitFor();
  assert.equal(await page.locator('.studio-title').innerText(),name+' Studio');
  assert(await page.locator('.app-nav').isVisible());
  const panel=await page.locator('.panel').first().evaluate(el=>{const s=getComputedStyle(el);return {radius:s.borderRadius,border:s.borderTopWidth}});
  assert.deepEqual(panel,{radius:'18px',border:'1px'});
  await page.screenshot({path:path.join(outputRoot,'editor-'+name.toLowerCase()+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),name+' editor mobile overflow');
  await page.screenshot({path:path.join(outputRoot,'editor-'+name.toLowerCase()+'-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
 }
 async function checkRichEditor(){
  const question=page.locator('.qtext').first(),toolbar=question.locator('..').locator('.rich-toolbar');
  await question.fill('Erste Zeile\nZweite Zeile');
  await question.evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range)});
  await toolbar.getByRole('button',{name:'Fett',exact:true}).click();
  await question.evaluate(el=>{const text=el.querySelector('strong,b').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,5);getSelection().removeAllRanges();getSelection().addRange(range)});
  await toolbar.getByRole('button',{name:'Unterstreichen',exact:true}).click();
  await toolbar.getByRole('button',{name:'Zentrieren',exact:true}).click();
  await question.evaluate(el=>{el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range)});
  await toolbar.getByRole('button',{name:'Zeilenumbruch',exact:true}).click();await page.keyboard.type('Dritte Zeile');
  await page.locator('#retryCloudSave').click();
  await page.waitForFunction(()=>window.__calls.some(x=>x.name==='save_teacher_library'&&x.args.p_payload.quizzes[0].questions[0].text==='Erste Zeile\nZweite Zeile\nDritte Zeile'));
  const saved=await page.evaluate(()=>window.__calls.filter(x=>x.name==='save_teacher_library').at(-1).args.p_payload.quizzes[0].questions[0]);
  assert.equal(saved.textFormat.align,'center');assert(saved.textFormat.ranges.some(r=>r.bold));assert(saved.textFormat.ranges.some(r=>r.underline));assert(!JSON.stringify(saved.textFormat).includes('Erste'));
  await question.evaluate(el=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1fkAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'paste.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))});
  await page.locator('.media-preview-editor').waitFor();await page.locator('[data-action="remove-question-media"]').click();
  await page.locator('[data-action="back-to-list"]').click();await page.locator('[data-action="open-quiz"]').click();
  assert((await page.locator('.qtext').first().innerHTML()).includes('<strong>'));
  assert.equal(await page.locator('.qtext').first().getAttribute('data-align'),'center');
  // Verify the saved formatting on the teacher's live board; there is no preview button.
  const live=await context.newPage();live.on('pageerror',e=>errors.push(e.message));
  try{
   await live.goto(base+'/index.html');
   await live.evaluate(question=>sessionStorage.setItem('test.formattedLiveQuestion',JSON.stringify(question)),saved);
   await live.goto(base+'/apps/quiz-studio/live.html?session=quiz-session');
   await live.locator('.question-text .quiz-rich-line').first().waitFor();
   for(const width of [1280,390]){
    await live.setViewportSize({width,height:900});
    assert.equal(await live.locator('.question-text .quiz-rich-line').count(),3);
    assert.equal(await live.locator('.question-text u').first().innerText(),'Erste');
    assert(await live.locator('.question-text strong,.question-text b').count()>0);
    assert.equal(await live.locator('.question-text .quiz-rich').evaluate(el=>getComputedStyle(el).textAlign),'center');
    assert(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Formatted live question fits at '+width);
    await live.screenshot({path:path.join(outputRoot,'live-quiz-formatted-'+(width===1280?'desktop':'mobile')+'.png'),fullPage:true});
   }
  }finally{await live.close();}
  // Answers are native text fields; formatting remains limited to questions.
  await page.locator('[data-action="add-question"][data-type="single"]').click();
  const option=page.locator('[data-field="option-text"]').first();await option.fill('Antwort');
  assert.equal(await option.evaluate(el=>el.tagName),'INPUT');
  assert.equal(await option.locator('..').locator('.rich-toolbar').count(),0);
  await option.press('Control+b');await option.fill('Antwort sicher');
  assert.equal(await option.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
  await page.locator('#retryCloudSave').click();
  await page.waitForFunction(()=>window.__calls.some(x=>x.name==='save_teacher_library'&&x.args.p_payload.quizzes[0].questions.at(-1).options?.[0].text==='Antwort sicher'));
 }
 async function checkImagePaste(){
  const question=page.locator('.qtext').first(),card=page.locator('.qcard').first();
  const beforeText=await question.innerText();
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function focusText(){
   await question.evaluate(el=>{el.scrollIntoView({block:'center',behavior:'instant'});el.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(el.querySelector('strong'));range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range)});
   await settle();return page.evaluate(()=>scrollY);
  }
  async function checkImage(label,before){
   await card.locator('.media-preview-editor').waitFor();await settle();
   assert.equal(await question.innerText(),beforeText,label+' changed question text');
   assert.equal(await question.getAttribute('data-align'),'center');assert(await question.locator('u').count()>0);assert(await question.locator('strong,b').count()>0);
   assert.equal(await question.locator('img').count(),0,'Image belongs to media, not rich text');
   assert(Math.abs((await page.evaluate(()=>scrollY))-before)<3,label+' changed scroll');
   await page.locator('#retryCloudSave').click();
   await page.waitForFunction(()=>window.__calls.some(x=>x.name==='save_teacher_library'&&x.args.p_payload.quizzes[0].questions[0].media?.type==='image'));
   const saved=await page.evaluate(()=>window.__calls.filter(x=>x.name==='save_teacher_library').at(-1).args.p_payload.quizzes[0].questions[0]);
   assert(saved.media.data.startsWith('data:image/png;base64,'));assert.equal(saved.textFormat.align,'center');
   await card.locator('[data-action="remove-question-media"]').click();
  }
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const imageData=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#28734b';ctx.fillRect(0,0,24,24);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);return canvas.toDataURL('image/png')});
  let before=await focusText();await page.keyboard.press('Control+V');await checkImage('Native clipboard paste',before);
  // Browser/office events can target a formatted descendant, not the outer textbox.
  for(const kind of ['nested-file','files-only','html-image']){
   before=await focusText();
   await question.evaluate((el,{kind,imageData})=>{
    const data=new DataTransfer(),file=new File([Uint8Array.from(atob(imageData.split(',')[1]),c=>c.charCodeAt(0))],'image.png',{type:'image/png'});
    if(kind==='html-image')data.setData('text/html','<img src="'+imageData+'" onerror="window.__pasteXss=true"><script>window.__pasteXss=true</script>');else data.items.add(file);
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    if(kind==='files-only')Object.defineProperty(event,'clipboardData',{value:{items:[],files:[file],getData:()=>''}});
    el.querySelector('strong').dispatchEvent(event);
   },{kind,imageData});
   await checkImage(kind,before);
   assert.equal(await page.evaluate(()=>window.__pasteXss),undefined);
  }
  await context.clearPermissions();
 }
 async function checkEditorScroll(){
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function positionAt(locator){await locator.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await settle();const y=await page.evaluate(()=>scrollY);assert(y>400,'Test must operate below the first screen');return y;}
  async function unchanged(before,label){await settle();const position=await page.evaluate(()=>({y:scrollY,max:Math.max(0,document.documentElement.scrollHeight-innerHeight)}));assert(Math.abs(position.y-Math.min(before,position.max))<3,label+': scroll moved from '+before+' to '+position.y);}
  async function clickStable(locator,label,confirm=false){const before=await positionAt(locator);if(confirm)page.once('dialog',d=>d.accept());await locator.click();await unchanged(before,label);}
  for(let i=0;i<7;i++)await page.locator('[data-action="add-question"][data-type="truefalse"]').click();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1fkAAAAASUVORK5CYII=','base64');
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});
   await clickStable(page.locator('[data-action="add-question"][data-type="truefalse"]'),'Add question '+width);
   await clickStable(page.locator('.qcard').last().locator('[data-action="del-question"]'),'Delete question '+width,true);
   const options=page.locator('.qcard').nth(2);
   await clickStable(options.locator('[data-action="add-option"]'),'Add option '+width);
   await clickStable(options.locator('[data-action="del-option"]').last(),'Delete option '+width);
   const card=page.locator('.qcard').nth(4),upload=card.locator('input[data-media-input]');
   await positionAt(card.locator('.media-upload-label'));
   // A slow file read must not undo scrolling done while the file was loading.
   await page.evaluate(()=>{window.__nativeFileReader=window.FileReader;window.FileReader=class extends window.__nativeFileReader{readAsDataURL(file){window.__releaseMediaRead=()=>super.readAsDataURL(file)}}});
   await upload.setInputFiles({name:'scroll.png',mimeType:'image/png',buffer:png});
   const during=await page.evaluate(()=>{scrollTo({top:scrollY+100,behavior:'instant'});return scrollY});
   await page.evaluate(()=>{window.__releaseMediaRead();window.FileReader=window.__nativeFileReader});
   await card.locator('.media-preview-editor').waitFor();await unchanged(during,'Media upload '+width);
   await clickStable(card.locator('[data-action="remove-question-media"]'),'Remove media '+width);
   const text=card.locator('.qtext'),before=await positionAt(text);
   await text.evaluate(el=>{el.focus({preventScroll:true});const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1fkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'paste.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))});
   await card.locator('.media-preview-editor').waitFor();await unchanged(before,'Paste media '+width);
   await clickStable(card.locator('[data-action="remove-question-media"]'),'Remove pasted media '+width);
  }
  await page.setViewportSize({width:1280,height:900});
  await page.locator('[data-action="back-to-list"]').evaluate(el=>el.click());await settle();assert.equal(await page.evaluate(()=>scrollY),0,'Library starts at top');
  await page.locator('[data-action="open-quiz"]').click();await settle();assert.equal(await page.evaluate(()=>scrollY),0,'Opening quiz starts at top');
 }
 await page.goto(base+'/index.html');await page.locator('#logoutBtn').waitFor({state:'visible'});assert.equal(await page.locator('.app-card').count(),4);await page.screenshot({path:path.join(outputRoot,'hub-desktop.png'),fullPage:true});
 await page.locator('.app-card[href="apps/umfrage/index.html"]').click();await page.waitForURL('**/apps/umfrage/index.html');await page.locator('#surveyList .empty').waitFor();assert.equal(await page.locator('#gamePanel').count(),0);await checkStudio('Umfrage');assert.equal(await page.locator('#logoutBtn').count(),0);await page.locator('#newSurveyBtn').click();await page.waitForURL('**/apps/umfrage/editor.html?new=1');await page.locator('#slideQuestion').fill('Wie gefällt dir der Unterricht?');await page.locator('#addSlideBtn').click();assert.equal(await page.locator('.slideCard').count(),2);await captureEditor('Umfrage');await page.locator('.app-nav a').first().click();await page.waitForURL('**/SchulApp/index.html');
 await page.locator('.app-card[href="apps/quiz-studio/index.html"]').click();await page.waitForURL('**/apps/quiz-studio/index.html');await page.locator('[data-action="new-quiz"]').waitFor();await checkStudio('Quiz');assert.equal(await page.locator('#retryCloudSave').count(),0);await page.locator('[data-action="open-quiz"]').click();await page.locator('#retryCloudSave').waitFor();await page.locator('#retryCloudSave').click();assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x.name==='save_teacher_library').length),0);await checkRichEditor();await checkImagePaste();await captureEditor('Quiz');await checkEditorScroll();await page.locator('[data-action="back-to-list"]').click();assert.equal(await page.locator('#retryCloudSave').count(),0);await page.locator('.app-nav a').first().click();
 await page.locator('.app-card[href="apps/jeopardy/index.html"]').click();await page.waitForURL('**/apps/jeopardy/index.html');await page.locator('#btnNew').waitFor();await checkStudio('Jeopardy');assert.equal(await page.locator('.storage-note').count(),0);await page.locator('#btnNew').click();await page.locator('#sname').fill('Design Test');await page.locator('#rows').selectOption('2');await page.locator('#cols').selectOption('2');await page.screenshot({path:path.join(outputRoot,'editor-jeopardy-setup.png'),fullPage:true});await page.locator('#btnContinue').click();await captureEditor('Jeopardy');await page.locator('.app-nav a').first().click();
 await page.locator('#logoutBtn').click();await page.locator('#loginLink').waitFor({state:'visible'});assert.equal(await page.locator('#logoutBtn').isVisible(),false);
 await page.goto(base+'/login.html?next=apps%2Fquiz-studio%2Findex.html');await page.waitForURL('**/apps/quiz-studio/index.html');
 await page.goto(base+'/login.html?next=https%3A%2F%2Fevil.example');await page.waitForURL('**/SchulApp/index.html');
 await page.goto(base+'/student.html?code=AAAAA#resume');await page.waitForURL('**/apps/umfrage/student.html?code=AAAAA#resume');assert.equal(await page.locator('#code').inputValue(),'AAAAA');
 await page.goto(base+'/quiz-student.html?code=BBBBB');await page.waitForURL('**/apps/quiz-studio/student.html?code=BBBBB');assert.equal(await page.locator('#joinCode').inputValue(),'BBBBB');
 await page.goto(base+'/join.html?code=AAAAA');await page.waitForURL('**/apps/umfrage/student.html?code=AAAAA');assert.equal(await page.locator('#code').inputValue(),'AAAAA');await page.locator('#name').fill('Testperson');await page.locator('#joinBtn').click();await page.locator('#pinBoard').waitFor();await page.locator('#pinBoard').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#pinX').inputValue(),'51');await page.locator('#submitBtn').click();await page.locator('#submitted').waitFor({state:'visible'});assert.deepEqual(await page.evaluate(()=>window.__calls.find(x=>x.name==='survey_submit_response').args.p_value),{x:51,y:50});
 await page.screenshot({path:path.join(outputRoot,'pin-desktop.png'),fullPage:true});
 await page.goto(base+'/join.html?code=BBBBB&kind=quiz');await page.waitForURL('**/apps/quiz-studio/student.html?code=BBBBB');await page.locator('#studentName').fill('Testperson');await page.locator('#joinForm button').click();await page.locator('#shortAnswer').fill('4');await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);assert.equal(await page.locator('#shortAnswer').inputValue(),'4');assert((await page.locator('#playerSyncStatus').textContent()).includes('Offline'));await context.setOffline(false);await page.waitForTimeout(200);assert.equal(await page.locator('#shortAnswer').inputValue(),'4');await page.locator('#submitAnswer').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_submit_response_secure'));assert.equal(await page.evaluate(()=>window.__calls.find(x=>x.name==='quiz_live_submit_response_secure').args.p_answer),'4');
 await page.evaluate(()=>{window.__formattedStudentQuestion={type:'single',points:1,options:[{id:'o1',text:'Antwort\nZeile zwei',textFormat:{align:'center',ranges:[{start:0,end:7,bold:true,underline:true}]}},{id:'o2',text:'Andere Antwort'}]}});
 await page.locator('.answer strong').waitFor();assert.equal(await page.locator('.answer u').first().innerText(),'Antwort');assert.equal(await page.locator('.answer .quiz-rich-line').count(),3);
 await page.locator('.answer input[value="o1"]').check();await page.locator('#submitAnswer').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_submit_response_secure'&&x.args.p_answer==='o1'));
 await page.evaluate(()=>{window.__formattedStudentQuestion={type:'ranking',points:1,items:[{id:'i1',text:'Erstes Element',textFormat:{ranges:[{start:0,end:6,underline:true}]}},{id:'i2',text:'Zweites Element'}]}});
 await page.locator('.rank-choices').waitFor();assert.equal(await page.locator('.rank-choices u').innerText(),'Erstes');
 await page.goto(base+'/apps/umfrage/live.html?id=survey-session');await page.locator('#liveQuestion').waitFor();assert.equal(await page.locator('.studio-title').innerText(),'Umfrage Studio');await page.screenshot({path:path.join(outputRoot,'live-umfrage-studio.png'),fullPage:true});
 await page.goto(base+'/apps/quiz-studio/live.html?session=quiz-session');
 await page.locator('[data-action="timer"]').waitFor();
 assert.equal(await page.locator('.question-text strong').innerText(),'Wie viel');assert.equal(await page.locator('.question-text .quiz-rich').evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert.equal(await page.locator('#joinDialog').isVisible(),false);
 assert.equal(await page.locator('#app .panel').count(),2);
 assert.equal(await page.locator('.question-toolbar [data-action="back"]').count(),1);
 assert.equal(await page.locator('.question-toolbar [data-action="next"]').count(),1);
 assert.equal(await page.locator('.question-toolbar [data-action="reveal"] .question-points').innerText(),'1 P');
 assert.equal(await page.locator('.ranking-heading [data-action="lock"]').count(),1);
 assert.equal(await page.locator('.question-panel .controls').count(),0);
 assert(!(await page.locator('#app').innerText()).includes('Die Schüler sehen nur die Antwortmöglichkeiten'));
 assert.deepEqual(await page.locator('#timerSeconds option').allTextContents(),['15s','30s','45s','60s','90s','2min','3min']);
 for(const width of [1024,950,768,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Live controls overflow at '+width);}
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:path.join(outputRoot,'live-quiz-compact-desktop.png'),fullPage:true});
 await page.locator('[data-action="access"]').click();await page.locator('#joinDialog').waitFor({state:'visible'});
 const pixels=await page.locator('#qrCode canvas').evaluate(c=>({data:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data),width:c.width,height:c.height}));
 const decoded=jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height);
 assert(decoded,'QR code must be machine-readable');assert.equal(decoded.data,base+'/join.html?code=BBBBB&kind=quiz');
 assert.equal(await page.locator('#joinDialog a').count(),1);
 assert.equal(await page.locator('#joinPageLink').getAttribute('href'),decoded.data);
 await page.screenshot({path:path.join(outputRoot,'live-quiz-qr-desktop.png'),fullPage:true});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#joinDialog').isVisible(),false);
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:path.join(outputRoot,'live-quiz-compact-mobile.png'),fullPage:true});
 await page.locator('[data-action="access"]').click();await page.locator('#joinDialog').waitFor({state:'visible'});
 assert(await page.evaluate(()=>document.querySelector('#joinDialog').scrollWidth<=document.querySelector('#joinDialog').clientWidth));
 await page.screenshot({path:path.join(outputRoot,'live-quiz-qr-mobile.png'),fullPage:true});
 await page.locator('#closeJoin').click();await page.setViewportSize({width:1280,height:900});
 const refreshCount=await page.evaluate(()=>window.__calls.filter(c=>c.name==='quiz_live_teacher_state').length);
 await page.locator('#timerSeconds').selectOption('45');
 assert.equal(await page.locator('[data-action="refresh"]').count(),0);
 await page.waitForFunction(previous=>window.__calls.filter(c=>c.name==='quiz_live_teacher_state').length>previous,refreshCount);
 assert.equal(await page.locator('#timerSeconds').inputValue(),'45');
 await page.locator('[data-action="timer"]').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_start_timer_at'));
 assert.equal(await page.evaluate(()=>window.__calls.find(x=>x.name==='quiz_live_start_timer_at').args.p_seconds),45);
 await page.setViewportSize({width:320,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.setViewportSize({width:1280,height:900});
 await page.locator('.ranking-heading [data-action="lock"]').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_lock_question'));
 await page.locator('[data-action="reveal"]').click();await page.waitForFunction(()=>!document.querySelector('[data-action="next"]').disabled);
 await page.locator('[data-action="next"]').evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>document.body.textContent.includes('Die Erde ist rund.'));
 assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x.name==='quiz_live_navigate_from').length),1);
 await page.locator('[data-action="back"]').click();await page.waitForFunction(()=>document.body.textContent.includes('Wie viel ist zwei plus zwei?'));

 await page.setViewportSize({width:390,height:844});await page.goto(base+'/index.html');await page.screenshot({path:path.join(outputRoot,'hub-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.goto(base+'/join.html');await page.screenshot({path:path.join(outputRoot,'join-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(errors.length,0,errors.join('\n'));
 await browser.close();server.close();console.log('PASS: native image clipboard, nested formatted paste targets, files-only/embedded HTML images, safe persisted media and unchanged formatting/scroll, stable editor scroll on desktop/mobile for question/option add/delete, delayed media upload/paste/removal, view navigation, decoded local QR code, access dialog, compact teacher controls, timer selection, ranking lock, top navigation, studio editors and live views, requested dashboard cleanup, editor-only retry persistence, shared studio typography/panels/buttons, mobile dashboards, hub, app dashboards, back navigation, login destinations, legacy QR links, project hosting prefix, survey/quiz routing, keyboard pins, saved answers, offline drafts, timer, double navigation, mobile layout, no browser exceptions');
})().catch(e=>{console.error(e);server.close();process.exit(1)});









