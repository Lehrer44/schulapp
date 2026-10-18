const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const owner='00000000-0000-4000-8000-000000000001';
let quiz={id:'mixed',title:'Gemischte Spielweisen',questions:[{id:'q1',type:'shortanswer',text:'Buzzer: Wie viel ist zwei plus zwei?',points:5,answers:['4']},{id:'q2',type:'shortanswer',text:'Schnellantwort: Zwei plus zwei?',points:5,answers:['4']},{id:'q3',type:'truefalse',text:'Klassisch: Die Erde ist rund.',points:3,correct:true,playMode:'classic'}]},session,people=[],entries=[],calls=[];
const state=()=>session.question_states[session.current_index]||{};
const rows=()=>entries.filter(r=>r.question_index===session.current_index).sort((a,b)=>a.submitted_at.localeCompare(b.submitted_at));
const ranks=()=>people.map(p=>({participant:p,score:entries.filter(r=>r.participant_id===p.id).reduce((sum,r)=>sum+r.awarded_points,0),answered:rows().some(r=>r.participant_id===p.id)}));
function revealNext(){const st=state(),next=rows().find(r=>!r.reviewed);st.active_response_id=next?.id||null;if(next)st.shown_ids.push(next.id);else st.revealed=true;}
function rpc(name,args={}){
 calls.push({name,args});const st=session?state():{};
 if(name==='save_teacher_library'){quiz=structuredClone(args.p_payload.quizzes[0]);return {ok:true,revision:2};}
 if(name==='quiz_live_create'){session={id:'mode-session',owner_id:owner,quiz_title:quiz.title,quiz_snapshot:args.p_quiz,status:'lobby',join_code:'ABCDE',current_index:-1,question_states:args.p_quiz.questions.map(q=>({mode:q.playMode&&q.playMode!=='inherit'?q.playMode:args.p_quiz.defaultMode,opened_at:null,locked:true,revealed:false,shown_ids:[]})),updated_at:'created'};return {ok:true,session_id:session.id,title:quiz.title,join_code:'ABCDE'};}
 if(name==='quiz_live_teacher_state')return {ok:true,session,leaderboard:ranks(),responses:rows().map(r=>({...r,answer:st.shown_ids.includes(r.id)||st.mode==='classic'&&st.revealed?r.answer:null}))};
 if(name==='quiz_live_start'){session.status='running';session.current_index=0;return {ok:true};}
 if(name==='quiz_live_set_round_mode'){assert(!st.opened_at);st.mode=args.p_mode;return {ok:true};}
 if(name==='quiz_live_open_round'){assert(!st.opened_at);st.opened_at=new Date().toISOString();st.locked=false;return {ok:true};}
 if(name==='classroom_join'){const person={id:'p'+(people.length+1),name:args.p_name};people.push(person);return {ok:true,session_id:session.id,participant_id:person.id,join_code:'ABCDE'};}
 if(name==='quiz_live_student_state_secure'){
  const q=structuredClone(session.quiz_snapshot.questions[session.current_index]||null),own=rows().find(r=>r.participant_id===args.p_participant_id)||null;
  if(q){delete q.text;if(!st.revealed){delete q.answers;delete q.correct;}}
  return {ok:true,status:session.status,title:quiz.title,current_index:session.current_index,question_count:3,question:q,question_state:st,play_mode:st.mode,round_open:!!st.opened_at,locked:!!st.locked,revealed:!!st.revealed,own_response:own,elapsed_ms:own?Date.parse(own.submitted_at)-Date.parse(st.opened_at):null,leaderboard:ranks().map(r=>({name:r.participant.name,score:r.score,answered:r.answered}))};
 }
 if(name==='quiz_live_submit_response_secure'){
  assert(st.opened_at&&!st.locked);const own=rows().find(r=>r.participant_id===args.p_participant_id);
  if(own&&st.mode!=='classic')return {ok:true,already_submitted:true};
  if(own){own.answer=args.p_answer;return {ok:true};}
  entries.push({id:'r'+(entries.length+1),participant_id:args.p_participant_id,question_index:session.current_index,answer:args.p_answer,submitted_at:new Date(Date.now()+entries.length).toISOString(),is_correct:null,awarded_points:0,reviewed:false});return {ok:true};
 }
 if(name==='quiz_live_begin_review'){st.locked=true;revealNext();return {ok:true};}
 if(name==='quiz_live_judge_entry'){
  assert.equal(st.active_response_id,args.p_response_id);const entry=rows().find(r=>r.id===args.p_response_id);entry.reviewed=true;entry.is_correct=args.p_correct;entry.awarded_points=args.p_correct?session.quiz_snapshot.questions[session.current_index].points:0;
  if(args.p_correct){st.winner_id=entry.participant_id;st.revealed=true;st.active_response_id=null;}else revealNext();return {ok:true};
 }
 if(name==='quiz_live_reveal_question'){st.locked=true;st.revealed=true;for(const r of rows()){r.is_correct=r.answer===true;r.awarded_points=r.is_correct?3:0;r.reviewed=true;}return {ok:true};}
 if(name==='quiz_live_navigate_from'){assert(st.revealed);assert.equal(args.p_expected_index,session.current_index);session.current_index=args.p_target_index;return {ok:true};}
 throw Error('Unexpected RPC '+name);
}
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://test').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+name);try{assert(file.startsWith(root+path.sep));res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
 await context.exposeBinding('__modeCall',(_,name,args)=>{if(name==='library')return {data:{revision:1,payload:{quizzes:[quiz]}}};if(name==='session')return {data:session};return {data:rpc(name,args)};});
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'${owner}'}}}),getSession:async()=>({data:{session:{user:{id:'${owner}'}}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:()=>window.__modeCall('library'),single:()=>window.__modeCall('session')}),rpc:(name,args)=>window.__modeCall(name,args)})}`}));
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const teacher=await context.newPage();await teacher.goto(base+'/apps/quiz-studio/index.html');await teacher.locator('[data-action="open-quiz"]').click();
 const mode=teacher.locator('select[data-field="play-mode"]').nth(1);await mode.selectOption('speed');await teacher.locator('#retryCloudSave').click();assert.equal(quiz.questions[1].playMode,'speed');
 await teacher.locator('[data-action="back-to-list"]').click();await teacher.locator('[data-action="live-quiz"]').click();await teacher.locator('#liveModeDialog').waitFor({state:'visible'});await teacher.locator('input[name="liveMode"][value="buzzer"]').check();await teacher.locator('#confirmLiveMode').click();await teacher.waitForURL('**/live.html?session=mode-session');
 assert.equal(session.quiz_snapshot.defaultMode,'buzzer');await teacher.locator('[data-action="start"]').click();
 assert.equal(await teacher.locator('#roundMode').inputValue(),'buzzer');await teacher.locator('#roundMode').selectOption('speed');await teacher.locator('#roundMode').selectOption('buzzer');
 const players=[];
 for(const name of ['Ada','Ben']){const page=await context.newPage();await page.setViewportSize({width:390,height:844});await page.goto(base+'/apps/quiz-studio/student.html?code=ABCDE');await page.locator('#studentName').fill(name);await page.locator('#joinForm button').click();await page.locator('#buzzButton').waitFor();assert(await page.locator('#buzzButton').isDisabled());players.push(page);}
 const [a,b]=players;
 await teacher.locator('[data-action="open-round"]').click();await a.waitForFunction(()=>!document.querySelector('#buzzButton').disabled);await a.locator('#buzzButton').click();await b.waitForFunction(()=>!document.querySelector('#buzzButton').disabled);await b.locator('#buzzButton').click();
 await teacher.waitForFunction(()=>document.querySelectorAll('.race-entry').length===2);assert.deepEqual(await teacher.locator('.race-entry strong').allTextContents(),['Ada','Ben']);assert(await a.locator('#buzzButton').isDisabled());assert(await teacher.locator('#roundMode').isDisabled());
 await teacher.screenshot({path:path.join(output,'modes-buzzer-desktop.png'),fullPage:true});await a.screenshot({path:path.join(output,'modes-buzzer-student.png'),fullPage:true});
 await teacher.locator('[data-action="begin-review"]').click();assert((await teacher.locator('.race-entry.active').innerText()).includes('Ada'));await teacher.locator('[data-action="judge-wrong"]').click();assert((await teacher.locator('.race-entry.active').innerText()).includes('Ben'));await teacher.locator('[data-action="judge-correct"]').click();assert.equal(ranks().find(r=>r.participant.name==='Ben').score,5);
 await teacher.locator('[data-action="next"]').click();assert.equal(await teacher.locator('#roundMode').inputValue(),'speed');await a.locator('#shortAnswer').waitFor();assert(await a.locator('#shortAnswer').isDisabled());await teacher.locator('[data-action="open-round"]').click();
 await a.waitForFunction(()=>!document.querySelector('#shortAnswer').disabled);await a.locator('#shortAnswer').fill('Wrong');await a.locator('#submitAnswer').click();await b.waitForFunction(()=>!document.querySelector('#shortAnswer').disabled);await b.locator('#shortAnswer').fill('4');await b.locator('#submitAnswer').click();await b.waitForFunction(()=>document.querySelector('#submitAnswer').disabled);assert(await b.locator('#shortAnswer').isDisabled());
 await teacher.waitForFunction(()=>document.querySelectorAll('.race-entry').length===2);assert(!(await teacher.locator('.race-panel').innerText()).includes('Wrong'));await teacher.locator('[data-action="begin-review"]').click();assert((await teacher.locator('.race-entry.active .race-answer').innerText()).includes('Wrong'));assert((await teacher.locator('.race-entry').nth(1).innerText()).includes('verdeckt'));
 await teacher.screenshot({path:path.join(output,'modes-speed-desktop.png'),fullPage:true});await teacher.setViewportSize({width:390,height:844});assert(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await teacher.screenshot({path:path.join(output,'modes-speed-mobile.png'),fullPage:true});await teacher.setViewportSize({width:1280,height:900});
 await teacher.locator('[data-action="judge-wrong"]').click();assert.equal(await teacher.locator('.race-entry.active .race-answer').innerText(),'4');await teacher.locator('[data-action="judge-correct"]').click();assert.equal(ranks().find(r=>r.participant.name==='Ben').score,10);await a.waitForFunction(()=>document.querySelector('.result')?.textContent.includes('nicht als erste richtige Antwort'));assert(!(await a.locator('.result').innerText()).includes('nicht richtig'));
 await teacher.locator('[data-action="next"]').click();assert.equal(await teacher.locator('#roundMode').inputValue(),'classic');await teacher.locator('[data-action="open-round"]').click();await a.waitForFunction(()=>!!document.querySelector('input[value="true"]')&&!document.querySelector('input[value="true"]').disabled);await a.locator('input[value="true"]').check();await a.locator('#submitAnswer').click();await teacher.locator('[data-action="reveal"]').click();assert.equal(ranks().find(r=>r.participant.name==='Ada').score,3);
 assert.equal(errors.length,0,errors.join('\n'));assert(calls.some(c=>c.name==='quiz_live_set_round_mode'));console.log('PASS: saved per-question modes, start dialog, moderator override/release, two mobile players, buzzer order, staged speed answers, automatic next candidate, one winner, classic round, responsive layouts');
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
