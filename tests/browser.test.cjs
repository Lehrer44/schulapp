const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const moduleRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(require.resolve('playwright',{paths:[moduleRoot,__dirname].filter(Boolean)}));
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-results');fs.mkdirSync(outputRoot,{recursive:true});
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body)}catch{res.writeHead(404);res.end()}});
async function fixtures(){
 window.__calls=[];
 const owner='00000000-0000-4000-8000-000000000001';
 const quiz={id:'quiz1',title:'Testquiz',questions:[{id:'q1',type:'shortanswer',text:'Wie viel ist zwei plus zwei?',points:1,answers:['4']},{id:'q2',type:'truefalse',text:'Die Erde ist rund.',points:1,correct:true}]};
 const survey={id:'survey-session',title:'Testumfrage',survey_snapshot:[{type:'Pin setzen',question:'Setze einen Punkt auf die Karte.'}],current_slide:0,status:'running',join_code:'AAAAA',updated_at:'2026-10-12T17:00:00Z'};
 const quizSession={id:'quiz-session',owner_id:owner,quiz_title:'Testquiz',quiz_snapshot:quiz,current_index:0,status:'running',join_code:'BBBBB',question_states:[{locked:false,revealed:false},{locked:false,revealed:false}],updated_at:'initial'};
 let surveyAnswer=null,quizAnswer=null;
 window.__testClient={auth:{async getUser(){return {data:{user:{id:owner}}}},async getSession(){return {data:{session:{user:{id:owner}}}}}},storage:{from(){return {async download(){return {error:{statusCode:'404',message:'Object not found'}}}}}},from(table){const conditions={};return {select(){return this},eq(k,v){conditions[k]=v;return this},async maybeSingle(){if(table==='teacher_libraries')return {data:{revision:1,payload:conditions.kind==='quiz'?{quizzes:[quiz]}:{games:[]}}};return {data:survey}},async single(){return {data:quizSession}}}},async rpc(name,args){if(!navigator.onLine)return {error:{message:'offline'}};window.__calls.push({name,args});
  if(name==='classroom_resolve_code')return {data:{ok:true,kinds:[args.p_join_code==='AAAAA'?'survey':'quiz']}};
  if(name==='classroom_join')return {data:{ok:true,session_id:args.p_kind==='survey'?'survey-session':'quiz-session',participant_id:'participant',join_code:args.p_join_code}};
  if(name==='survey_student_state_compact'){const state={...survey};if(!args.p_include_snapshot)delete state.survey_snapshot;return {data:{ok:true,session:state,response:surveyAnswer}};}
  if(name==='survey_submit_response'){surveyAnswer={answer:{value:args.p_value}};return {data:{ok:true}}}
  if(name==='quiz_live_student_state_secure')return {data:{ok:true,status:'running',current_index:0,title:'Testquiz',question_count:2,question:{type:'shortanswer',points:1},question_state:{locked:false,revealed:false},own_response:quizAnswer,leaderboard:[],locked:false,revealed:false}};
  if(name==='quiz_live_submit_response_secure'){quizAnswer={answer:args.p_answer};return {data:{ok:true}}}
  if(name==='quiz_live_teacher_state')return {data:{ok:true,session:quizSession,leaderboard:[],responses:[]}};
  if(name==='quiz_live_start_timer_at'){assertIndex(args.p_question_index);quizSession.question_states[0].timer_deadline=new Date(Date.now()+30000).toISOString();return {data:{ok:true}}}
  if(name==='quiz_live_reveal_question'){quizSession.question_states[0].revealed=true;quizSession.question_states[0].locked=true;quizSession.updated_at='revealed';return {data:{ok:true}}}
  if(name==='quiz_live_navigate_from'){assertIndex(args.p_expected_index);await new Promise(r=>setTimeout(r,100));quizSession.current_index=args.p_target_index;quizSession.updated_at='navigated';return {data:{ok:true}}}
  return {data:{ok:true,revision:2}};
 }};
 function assertIndex(index){if(index!==quizSession.current_index)throw Error('stale index');}
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(fixtures);
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().includes('supabase')?'window.supabase={createClient:()=>window.__testClient}':'window.QRCode={toCanvas:(c,u,o,cb)=>cb(null)}'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/join.html?code=AAAAA');await page.waitForURL('**/student.html?code=AAAAA');assert.equal(await page.locator('#code').inputValue(),'AAAAA');await page.locator('#name').fill('Testperson');await page.locator('#joinBtn').click();await page.locator('#pinBoard').waitFor();await page.locator('#pinBoard').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#pinX').inputValue(),'51');await page.locator('#submitBtn').click();await page.locator('#submitted').waitFor({state:'visible'});assert.deepEqual(await page.evaluate(()=>window.__calls.find(x=>x.name==='survey_submit_response').args.p_value),{x:51,y:50});
 await page.screenshot({path:path.join(outputRoot,'pin-desktop.png'),fullPage:true});
 await page.goto(base+'/join.html?code=BBBBB&kind=quiz');await page.waitForURL('**/quiz-student.html?code=BBBBB');await page.locator('#studentName').fill('Testperson');await page.locator('#joinForm button').click();await page.locator('#shortAnswer').fill('4');await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);assert.equal(await page.locator('#shortAnswer').inputValue(),'4');assert((await page.locator('#connectionStatus').textContent()).includes('Offline'));await context.setOffline(false);await page.waitForTimeout(200);assert.equal(await page.locator('#shortAnswer').inputValue(),'4');await page.locator('#submitAnswer').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_submit_response_secure'));assert.equal(await page.evaluate(()=>window.__calls.find(x=>x.name==='quiz_live_submit_response_secure').args.p_answer),'4');
 await page.goto(base+'/quiz-live.html?session=quiz-session');await page.locator('[data-action="timer"]').waitFor();await page.locator('[data-action="timer"]').click();await page.waitForFunction(()=>window.__calls.some(x=>x.name==='quiz_live_start_timer_at'));await page.locator('[data-action="reveal"]').click();await page.waitForFunction(()=>!document.querySelector('[data-action="next"]').disabled);await page.locator('[data-action="next"]').evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>document.body.textContent.includes('Die Erde ist rund.'));assert.equal(await page.evaluate(()=>window.__calls.filter(x=>x.name==='quiz_live_navigate_from').length),1);
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/join.html');await page.screenshot({path:path.join(outputRoot,'join-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(errors.length,0,errors.join('\n'));
 await browser.close();server.close();console.log('PASS: survey/quiz routing, keyboard pins, saved answers, offline drafts, timer, double navigation, mobile layout, no browser exceptions');
})().catch(e=>{console.error(e);server.close();process.exit(1)});
