// Execute the real survey pages with an offline, stateful database fixture.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{
  let body=fs.readFileSync(file,'utf8');
  if(file.endsWith('.html'))body=body.replace(/<script[^>]+src="https:\/\/[^"]*supabase[^"]*"[^>]*><\/script>/gi,'<script>window.supabase={createClient:()=>window.__surveyClient};</script>');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
function fixture(){
 const owner='00000000-0000-4000-8000-000000000001';
 const slides=[{type:'Multiple-Choice',question:'Welche Bewegung ist gleichförmig?',options:['Bahn mit konstanter Geschwindigkeit','Anfahrendes Fahrrad']},{type:'Offene Frage',question:'Begründe deine Entscheidung.'}];
 const saved=sessionStorage.getItem('survey-test-state');
 const state=window.__surveyState=saved?JSON.parse(saved):{
  surveys:[{id:'template',name:'Bewegungen untersuchen',slides}],
  sessions:['lobby','running','ended'].map((status,i)=>({id:status,owner_id:owner,title:'Testumfrage '+status,status,join_code:'ABCD'+i,current_slide:0,survey_snapshot:slides,created_at:'2026-10-20T10:00:00Z',updated_at:'initial'})),
  participants:['lobby','running','ended'].map(id=>({id:'p-'+id,session_id:id,name:'Alex',joined_at:'2026-10-20T10:00:00Z'})),
  responses:[{id:'response',session_id:'ended',participant_id:'p-ended',slide_index:0,answer:{value:slides[0].options[0]},created_at:'2026-10-20T10:01:00Z'}]
 };
 const persist=()=>sessionStorage.setItem('survey-test-state',JSON.stringify(state));
 window.__mutations=[];
 const subscriptions=[];
 window.__surveyEmit=(table,payload)=>subscriptions.filter(s=>s.table===table).forEach(s=>s.callback(payload));
 window.__surveyClient={
  auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
  channel(){return {on(event,filter,callback){subscriptions.push({table:filter.table,callback});return this},subscribe(cb){cb?.('SUBSCRIBED');return this}}},removeChannel:async()=>{},
  from(table){
   let operation='select',payload,filters=[],start=0,end=Infinity;
   const execute=async(single=false)=>{
    const rows=(state[table]||[]).filter(row=>filters.every(test=>test(row)));
    if(operation!=='select'){
     window.__mutations.push({table,operation,ids:rows.map(row=>row.id),payload});
     const failure=window.__failNext;window.__failNext=null;
     await new Promise(resolve=>setTimeout(resolve,80));
     if(failure==='throw')throw Error('Netzwerkfehler');
     if(failure==='error')return {data:null,error:{message:'Testfehler'}};
     if(failure==='empty')return {data:single?null:[],error:null};
     if(operation==='update')rows.forEach(row=>Object.assign(row,payload,{updated_at:crypto.randomUUID()}));
     if(operation==='delete'){
      state[table]=state[table].filter(row=>!rows.includes(row));
      if(table==='sessions')for(const child of ['participants','responses'])state[child]=state[child].filter(row=>!rows.some(session=>row.session_id===session.id));
     }
     persist();
    }
    return {data:single?structuredClone(rows[0]||null):structuredClone(rows.slice(start,end+1)),error:null};
   };
   return {select(){return this},eq(key,value){filters.push(row=>row[key]===value);return this},in(key,values){filters.push(row=>values.includes(row[key]));return this},order(){return this},range(a,b){start=a;end=b;return this},delete(){operation='delete';return this},update(value){operation='update';payload=value;return this},single(){return execute(true)},maybeSingle(){return execute(true)},then(resolve,reject){return execute().then(resolve,reject)}};
  },
  async rpc(name,args){
   if(name==='classroom_resolve_code')return {data:{ok:true,kinds:['survey']},error:null};
   if(name!=='restart_owned_session')throw Error('Unexpected RPC '+name);
   const session=state.sessions.find(row=>row.id===args.p_session_id);
   session.current_slide=0;session.status='running';state.responses=state.responses.filter(row=>row.session_id!==session.id);persist();
   return {data:[structuredClone(session)],error:null};
  }
 };
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:844}});
   await context.addInitScript(fixture);
   await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.fulfill({contentType:'text/javascript',body:''}));
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/apps/umfrage/index.html');
   await page.locator('#endedSessionList .exportCsvBtn').waitFor();
   assert.equal(await page.locator('#settingsBtn,#settingsModal,#refreshSessionsBtn,#refreshEndedBtn').count(),0);
   assert.equal(await page.locator('#surveyPanel > .panelHeader #newSurveyBtn').count(),1);
   for(const button of await page.locator('#newSurveyBtn,.deleteSessionBtn,#surveyList .del,#surveyList .edit').all()){
    assert.equal((await button.innerText()).trim(),'');assert(await button.getAttribute('aria-label'));
    const box=await button.boundingBox();assert(box.width>=44&&box.height>=44,'Icon controls remain touch-friendly');
   }
   assert.equal(await page.locator('.studio-title').evaluate(el=>getComputedStyle(el).fontSize),width===390?'20px':'24px');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
   await page.screenshot({path:path.join(root,`test-results/survey-library-${width}.png`),fullPage:true});
   // CSV export still works after adding the independent delete action.
   const download=page.waitForEvent('download');await page.locator('#endedSessionList .exportCsvBtn').click();
   assert((await download).suggestedFilename().endsWith('.csv'));
   // Cancelling and failed/denied deletion never remove a session or its template.
   const del=page.locator('#activeSessionList .deleteSessionBtn').first();
   page.once('dialog',dialog=>dialog.dismiss());await del.click();assert.equal(await page.locator('#activeSessionList .item').count(),2);
   for(const failure of ['error','empty']){
    await page.evaluate(value=>window.__failNext=value,failure);
    page.once('dialog',dialog=>dialog.accept());await del.click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Löschen fehlgeschlagen:'));
    await page.waitForFunction(()=>!document.querySelector('#activeSessionList .deleteSessionBtn').disabled);
    assert.equal(await page.locator('#activeSessionList .item').count(),2);
   }
   page.once('dialog',dialog=>dialog.accept());await del.click();
   await page.waitForFunction(()=>document.querySelectorAll('#activeSessionList .item').length===1);
   page.once('dialog',dialog=>dialog.accept());await page.locator('#endedSessionList .deleteSessionBtn').click();
   await page.locator('#endedSessionList .empty').waitFor();
   assert.equal(await page.locator('#endedSessionList .empty').innerText(),'Noch keine durchgeführten Umfragen.');
   assert.equal(await page.locator('#surveyList .item').count(),1);
   assert.deepEqual(await page.evaluate(()=>window.__surveyState.sessions.map(row=>row.id)),['running']);
   assert.deepEqual(await page.evaluate(()=>window.__surveyState.participants.map(row=>row.session_id)),['running']);
   assert.equal(await page.evaluate(()=>window.__surveyState.responses.length),0);
   // Reset the fixture and run through lobby -> start -> navigation -> restart -> stop.
   await page.evaluate(()=>sessionStorage.removeItem('survey-test-state'));
   await page.goto(base+'/apps/umfrage/live.html?id=lobby');
   await page.locator('#startBtn').waitFor({state:'visible'});
   assert.equal(await page.locator('.metricRow,#participantMetric,#rateMetric,#slideMetric,.studio-subtitle').count(),0);
   assert.equal(await page.locator('.main #slideInfo').innerText(),'Folie 0 / 2');
   assert.equal(await page.locator('.studio-header #startBtn').count(),0);
   assert.equal(await page.locator('.questionHead .questionSlot #startBtn').innerText(),'Umfrage starten');
   assert(await page.locator('#liveQuestion').isHidden());
   await page.locator('#accessBtn').click();
   const joinLink=page.getByRole('link',{name:'Teilnahmeseite öffnen',exact:true});
   assert.equal(await joinLink.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   const target=new URL(await joinLink.getAttribute('href'));
   assert.equal(target.pathname,'/join.html');assert.equal(target.searchParams.get('code'),'ABCD0');assert.equal(target.searchParams.get('kind'),'survey');
   const popupPromise=page.waitForEvent('popup');await joinLink.click();const popup=await popupPromise;
   await popup.waitForURL('**/apps/umfrage/student.html?code=ABCD0');
   assert.equal(await popup.locator('#code').inputValue(),'ABCD0');await popup.close();
   assert(page.url().includes('/live.html?id=lobby'));
   await page.locator('#closeAccess').click();
   await page.screenshot({path:path.join(root,`test-results/survey-lobby-${width}.png`),fullPage:true});
   await page.locator('#startBtn').click();
   await page.waitForFunction(()=>document.querySelector('#startBtn').classList.contains('hidden')&&!document.querySelector('#stopBtn').disabled);
   assert.equal(await page.locator('#slideInfo').innerText(),'Folie 1 / 2');
   assert(await page.locator('#restartBtn').isEnabled());
   await page.locator('#nextBtn').click();
   await page.waitForFunction(()=>document.querySelector('#slideInfo').textContent==='Folie 2 / 2'&&!document.querySelector('#stopBtn').disabled);
   assert(await page.locator('#prevBtn').isEnabled());assert(await page.locator('#nextBtn').isDisabled());
   page.once('dialog',dialog=>dialog.accept());await page.locator('#restartBtn').click();
   await page.waitForFunction(()=>document.querySelector('#slideInfo').textContent==='Folie 1 / 2'&&!document.querySelector('#stopBtn').disabled);
   await page.screenshot({path:path.join(root,`test-results/survey-live-${width}.png`),fullPage:true});
   page.once('dialog',dialog=>dialog.dismiss());await page.locator('#stopBtn').click();
   await page.waitForFunction(()=>!document.querySelector('#stopBtn').disabled);
   for(const failure of ['error','empty','throw']){
    await page.evaluate(value=>window.__failNext=value,failure);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#stopBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#stopBtn').disabled&&document.querySelector('#connectionStatus').dataset.state==='error');
    assert(page.url().includes('/live.html?id=lobby'));
   }
   page.once('dialog',dialog=>dialog.accept());await page.locator('#stopBtn').click();
   await page.waitForURL('**/apps/umfrage/index.html');
   assert.equal(await page.evaluate(()=>window.__surveyState.sessions.find(row=>row.id==='lobby').status),'ended');
   // Each question uses one result surface; incoming changes use the actual realtime handlers.
   await page.evaluate(()=>sessionStorage.removeItem('survey-test-state'));
   await page.goto(base+'/apps/umfrage/live.html?id=running');
   await page.locator('.choiceResult').first().waitFor();
   assert.equal(await page.locator('#liveOptions,.answers,#answerTitle').count(),0);
   assert.equal(await page.locator('.choiceResult').count(),2);
   assert.deepEqual(await page.locator('.choiceCount').allTextContents(),['0','0']);
   assert(await page.getByRole('button',{name:'Namen zeigen',exact:true}).isVisible());
   await page.evaluate(()=>{
    const s=window.__surveyState;
    s.participants=[{id:'p1',session_id:'running',name:'Alex',joined_at:'1'},{id:'p2',session_id:'running',name:'Sam',joined_at:'2'},{id:'p3',session_id:'running',name:'Kim <img src=x>',joined_at:'3'}];
    const response=(id,participant_id,value)=>({id,participant_id,session_id:'running',slide_index:0,answer:{value},created_at:'2026-10-20T10:01:00Z'});
    s.responses=[response('r1','p1',s.sessions[1].survey_snapshot[0].options[0]),response('r2','p2',s.sessions[1].survey_snapshot[0].options[1])];
    window.__surveyEmit('responses',{new:s.responses[0]});
   });
   await page.waitForFunction(()=>document.querySelector('.choiceCount').textContent==='1');
   assert.deepEqual(await page.locator('.choiceCount').allTextContents(),['1','1']);
   assert.equal(await page.locator('.choiceFill').first().evaluate(el=>el.style.width),'50%');
   assert.deepEqual(await page.locator('.choiceNames').allTextContents(),['','']);
   await page.getByRole('button',{name:'Namen zeigen',exact:true}).click();
   assert.deepEqual(await page.locator('.choiceNames').allTextContents(),['Alex','Sam']);
   // A third response must update the already visible names, counts and filling.
   await page.evaluate(()=>{
    const s=window.__surveyState;
    const r={id:'r3',participant_id:'p3',session_id:'running',slide_index:0,answer:{value:s.sessions[1].survey_snapshot[0].options[0]},created_at:'2026-10-20T10:02:00Z'};
    s.responses.push(r);window.__surveyEmit('responses',{new:r});
   });
   await page.waitForFunction(()=>document.querySelector('.choiceCount').textContent==='2');
   assert.deepEqual(await page.locator('.choiceNames').allTextContents(),['Alex, Kim <img src=x>','Sam']);
   assert.equal(await page.locator('.choiceNames img').count(),0);
   assert(Math.abs(parseFloat(await page.locator('.choiceFill').first().evaluate(el=>el.style.width))-200/3)<.01);
   await page.screenshot({path:path.join(root,`test-results/survey-choices-${width}.png`),fullPage:true});
   await page.getByRole('button',{name:'Namen ausblenden',exact:true}).click();
   assert.deepEqual(await page.locator('.choiceNames').allTextContents(),['','']);
   // Removing an answer through the participant list also updates the single result view.
   await page.locator('[data-participant-id="p1"]').click();
   await page.waitForFunction(()=>document.querySelector('.choiceCount').textContent==='1');
   assert.deepEqual(await page.locator('.choiceCount').allTextContents(),['1','1']);
   async function setQuestion(slide,responses=[]){
    await page.evaluate(({slide,responses})=>{
     const s=window.__surveyState,room=s.sessions.find(s=>s.id==='running');
     room.survey_snapshot=[slide];room.current_slide=0;room.updated_at=crypto.randomUUID();
     s.responses=responses.map((value,i)=>({id:'r'+i,participant_id:'p'+(i+1),session_id:'running',slide_index:0,answer:{value},created_at:'2026-10-20T10:00:00Z'}));
     window.__surveyEmit('sessions',{new:structuredClone(room)});
    },{slide,responses});
    await page.waitForFunction(question=>document.querySelector('#liveQuestion').textContent===question,slide.question);
   }
   await setQuestion({type:'Ranking',question:'Ordne die Energieträger.',options:['Sonne','Wind','Kohle']});
   await page.waitForFunction(()=>document.querySelectorAll('.rankRow').length===3);
   assert(await page.locator('#showNamesBtn').isHidden());
   assert.equal(await page.locator('.rankRow').first().locator('div').first().evaluate(el=>el.firstChild.textContent),'Sonne');
   await page.evaluate(()=>{
    const r={id:'ranking',participant_id:'p1',session_id:'running',slide_index:0,answer:{value:['Wind','Sonne','Kohle']},created_at:'2026-10-20T10:00:00Z'};
    window.__surveyState.responses=[r];window.__surveyEmit('responses',{new:r});
   });
   await page.waitForFunction(()=>document.querySelector('.rankRow>div').firstChild.textContent==='Wind');
   await page.screenshot({path:path.join(root,`test-results/survey-ranking-${width}.png`),fullPage:true});
   await setQuestion({type:'Skala',question:'Wie beurteilst du den Unterricht?',scaleItems:[{statement:'Verständlichkeit',min:0,max:10},{statement:'Tempo',min:-5,max:5}]},[{values:[{value:2},{value:-3}]},{values:[{value:8},{value:3}]}]);
   await page.waitForFunction(()=>document.querySelector('.scaleAverage')?.textContent==='Ø 5,0');
   assert.equal(await page.locator('.scaleLiveItem').count(),2);
   assert.equal(await page.locator('.scaleLiveStatement').getByText('Verständlichkeit',{exact:true}).count(),1);
   assert.equal(await page.locator('.scaleLiveMarker').first().evaluate(el=>el.style.left),'50%');
   assert.deepEqual(await page.locator('.scaleAverage').allTextContents(),['Ø 5,0','Ø 0,0']);
   // Fallback polling still works when a realtime event is missed.
   await page.evaluate(()=>{window.__surveyState.responses[0].answer.value.values[0].value=10;});
   await page.waitForFunction(()=>document.querySelector('.scaleAverage').textContent==='Ø 9,0');
   assert.equal(await page.locator('.scaleLiveMarker').first().evaluate(el=>el.style.left),'90%');
   assert(await page.locator('#showNamesBtn').isHidden());
   await page.screenshot({path:path.join(root,`test-results/survey-scale-${width}.png`),fullPage:true});
   await setQuestion({type:'Offene Frage',question:'Was möchtest du verbessern?'},['Mehr Experimente']);
   await page.getByText('Mehr Experimente',{exact:true}).waitFor();
   assert.equal(await page.locator('.textAnswer').count(),1);
   assert.equal(await page.locator('#liveOptions').count(),0);
   assert(await page.locator('#showNamesBtn').isHidden());
   await setQuestion({type:'Wortwolke',question:'Welche Themen interessieren dich?'},['Energie Licht Energie','Magnetismus Licht','Bewegung']);
   await page.waitForFunction(()=>document.querySelectorAll('.chip').length===4);
   assert.equal(await page.locator('.chip').count(),4);
   const colours=await page.locator('.chip').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));
   assert(new Set(colours).size>1);
   assert(await page.locator('#showNamesBtn').isHidden());
   await page.screenshot({path:path.join(root,`test-results/survey-words-${width}.png`),fullPage:true});
   await setQuestion({type:'Pin setzen',question:'Markiere den Ort.'},[{x:0,y:0},{x:100,y:100},{x:50,y:50}]);
   await page.waitForFunction(()=>document.querySelectorAll('.pin').length===3);
   assert.deepEqual(await page.locator('.pin').allTextContents(),['1','2','3']);
   assert.deepEqual(await page.locator('.pinLegendDot').allTextContents(),['1','2','3']);
   assert.equal(await page.locator('.pinLegendItem').nth(2).locator('span').nth(1).innerText(),'Kim <img src=x>');
   assert(await page.locator('#showNamesBtn').isHidden());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Results fit '+width);
   await page.screenshot({path:path.join(root,`test-results/survey-pins-${width}.png`),fullPage:true});
   // Legacy Q&A loads as an open question; it is no longer offered in the editor.
   await page.evaluate(()=>{
    window.__surveyState.surveys[0].slides=[{type:'Q&A',question:'Alte Frage',media:null}];
    sessionStorage.setItem('survey-test-state',JSON.stringify(window.__surveyState));
   });
   await page.goto(base+'/apps/umfrage/editor.html?id=template');
   await page.locator('#slideQuestion').waitFor();
   assert.equal(await page.locator('.typeBtn').count(),6);
   assert.equal(await page.locator('.typeBtn.selected strong').innerText(),'Offene Frage');
   assert.equal(await page.locator('.typeBtn').getByText('Q&A',{exact:true}).count(),0);
   assert.equal(await page.locator('#slideQuestion').inputValue(),'Alte Frage');
   await page.locator('#saveBtn').click();
   await page.waitForFunction(()=>window.__surveyState.surveys[0].slides[0].type==='Offene Frage');
   assert.deepEqual(errors,[]);await context.close();
   console.log('PASS: survey layout, accessible icon actions, CSV, individual deletion, start/navigation/restart/stop and error recovery at '+width+'px');
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

