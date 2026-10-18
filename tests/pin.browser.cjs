const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,__dirname].filter(Boolean)}));
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}});
function fixtures(){
 const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const c=canvas.getContext('2d');c.fillStyle='#e0e8dc';c.fillRect(0,0,400,200);c.fillStyle='#b7cfdd';c.fillRect(0,0,140,200);c.fillStyle='#698668';c.fillRect(225,50,30,30);
 const pin={id:'pin1',type:'pin',text:'Wo liegt der gesuchte Ort?',points:3,pinAspect:2,pinTarget:{x:60,y:30,radius:10},media:{type:'image',data:canvas.toDataURL('image/png'),name:'Karte.png'}};
 const quiz={id:'quiz1',title:'Pin-Test',questions:[pin,{id:'q2',type:'shortanswer',text:'Zweite Frage',points:1,answers:['4']},{id:'q3',type:'truefalse',text:'Dritte Frage',points:1,correct:true}]};
 const game={id:'game1',name:'Original',rows:1,cols:1,colHeaders:['Ort'],rowHeaders:['1'],points:[[100]],cells:{'0,0':{type:'text',text:'Frage',answer:'Antwort'}}};
 const owner='00000000-0000-4000-8000-000000000001';let own=null;window.__calls=[];window.__failEnd=false;
 window.__session={id:'live',owner_id:owner,quiz_title:quiz.title,quiz_snapshot:quiz,current_index:0,status:'running',join_code:'ABCDE',question_states:[{mode:'classic',locked:false,revealed:false,opened_at:new Date().toISOString()}],updated_at:'initial'};
 window.__quiz=quiz;window.__game=game;
 window.__client={auth:{async getUser(){return {data:{user:{id:owner}}}}},storage:{from(){return {async download(){return {error:{statusCode:404}}}}}},from(table){const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){return {data:{revision:1,payload:filters.kind==='quiz'?{quizzes:[structuredClone(quiz)]}:{games:[structuredClone(game)]}}}},async single(){return {data:window.__session}}}},async rpc(name,args){window.__calls.push({name,args});const session=window.__session;
 if(name==='save_teacher_library')return {data:{ok:true,revision:2}};
 if(name==='classroom_join')return {data:{ok:true,session_id:'live',participant_id:'p1',join_code:'ABCDE'}};
 if(name==='quiz_live_submit_response_secure'){own={answer:args.p_answer,is_correct:true,awarded_points:3};return {data:{ok:true}};}
 if(name==='quiz_live_student_state_secure'){const q=structuredClone(pin);if(!session.question_states[0].revealed)delete q.pinTarget;return {data:{ok:true,status:session.status,current_index:0,question_count:3,question:q,question_state:session.question_states[0],round_open:true,play_mode:'classic',locked:session.question_states[0].locked,revealed:session.question_states[0].revealed,own_response:own,leaderboard:[]}};}
 if(name==='quiz_live_teacher_state')return {data:{ok:true,session,leaderboard:[{participant:{id:'p1',name:'Ada'},score:3,answered:true},{participant:{id:'p2',name:'Ben'},score:0,answered:true}],responses:session.question_states[0].revealed?[{id:'r1',participant_id:'p1',question_index:0,answer:{x:60,y:30},is_correct:true,awarded_points:3},{id:'r2',participant_id:'p2',question_index:0,answer:{x:90,y:70},is_correct:false,awarded_points:0}]:[]}};
 if(name==='quiz_live_reveal_question'){session.question_states[0].revealed=true;session.question_states[0].locked=true;session.updated_at='revealed';return {data:{ok:true}};}
 if(name==='quiz_live_end'){if(window.__failEnd)return {error:{message:'Verbindung unterbrochen'}};session.status='ended';return {data:{ok:true}};}
 return {data:{ok:true}};
 }};
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/SchulApp';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
 try{
 await context.addInitScript(fixtures);await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>window.__client}'}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/apps/quiz-studio/index.html');await page.locator('[data-action="play-quiz"]').click();
 await page.locator('[data-action="preview-next"]').click();assert.match(await page.locator('.play-question').innerText(),/Zweite/);
 await page.locator('[data-action="preview-next"]').click();assert.match(await page.locator('.play-question').innerText(),/Dritte/);
 await page.locator('[data-action="preview-back"]').click();await page.locator('[data-pfield="shortanswer"]').fill('4');await page.locator('#primaryBtn').click();
 await page.locator('[data-action="preview-back"]').click();await page.locator('[data-pin-x]').fill('60');await page.locator('[data-pin-y]').fill('30');await page.locator('#primaryBtn').click();assert.match(await page.locator('.fb-title').innerText(),/Richtig/);
 await page.locator('[data-action="preview-next"]').click();assert.equal(await page.locator('[data-pfield="shortanswer"]').inputValue(),'4');assert.match(await page.locator('.fb-title').innerText(),/Richtig/);
 page.on('dialog',d=>d.accept());await page.locator('[data-action="quit-play"]').click();await page.locator('[data-action="open-quiz"]').click();
 await page.locator('[data-action="add-question"][data-type="pin"]').click();assert.equal(await page.locator('.qcard').count(),4);
 const first=page.locator('.qcard').first(),board=first.locator('.quiz-pin-board');await board.click({position:{x:100,y:70}});await first.locator('[data-pin-radius]').fill('12');await page.locator('#retryCloudSave').click();
 await page.waitForFunction(()=>window.__calls.filter(x=>x.name==='save_teacher_library').at(-1)?.args.p_payload.quizzes[0].questions[0].pinTarget?.radius===12);
 const saved=await page.evaluate(()=>window.__calls.filter(x=>x.name==='save_teacher_library').at(-1).args.p_payload.quizzes[0].questions[0]);assert.equal(saved.pinTarget.radius,12);assert.equal(saved.pinAspect,2);
 const circle=await first.locator('.quiz-pin-target').boundingBox();assert(Math.abs(circle.width-circle.height)<2,'Solution is a circle on a wide image');
 await page.screenshot({path:path.join(out,'pin-editor-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'pin-editor-mobile.png'),fullPage:true});
 const mobileCircle=await first.locator('.quiz-pin-target').boundingBox();assert(Math.abs(mobileCircle.width-mobileCircle.height)<2);
 await page.goto(base+'/apps/quiz-studio/student.html?code=ABCDE');await page.locator('#studentName').fill('Ada');await page.locator('#joinForm button').click();
 await page.locator('.quiz-pin-board').waitFor();assert.match(await page.locator('.main h1').innerText(),/Wo liegt/);assert.equal(await page.locator('.quiz-pin-target').isVisible(),false);
 await page.locator('.quiz-pin-board').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-pin-x]').inputValue(),'51');
 await page.locator('[data-pin-x]').fill('60');await page.locator('[data-pin-y]').fill('30');await page.locator('#submitAnswer').click();
 await page.waitForFunction(()=>window.__calls.some(c=>c.name==='quiz_live_submit_response_secure'));assert.deepEqual(await page.evaluate(()=>window.__calls.find(c=>c.name==='quiz_live_submit_response_secure').args.p_answer),{x:60,y:30});
 await page.screenshot({path:path.join(out,'pin-student-mobile.png'),fullPage:true});
 await page.evaluate(()=>{window.__session.question_states[0].revealed=true;window.__session.question_states[0].locked=true;});await page.waitForSelector('.quiz-pin-target:not([hidden])');
 assert.match(await page.locator('.result').innerText(),/Richtig/);assert.equal(await page.locator('[data-pin-x]').count(),0);
 await page.goto(base+'/apps/quiz-studio/live.html?session=live');await page.locator('[data-action="reveal"]').click();assert.equal(await page.locator('.quiz-pin-marker').count(),2);assert.match(await page.locator('.quiz-pin-legend').innerText(),/Ada.*Ben/s);assert.notEqual(await page.locator('.quiz-pin-marker').nth(0).evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('.quiz-pin-marker').nth(1).evaluate(el=>getComputedStyle(el).backgroundColor));assert.equal(await page.locator('header [data-action="end-quiz"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(181, 51, 53)');
 assert.equal(await page.getByRole('button',{name:'Aktualisieren',exact:true}).count(),0);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(out,'pin-live-desktop.png'),fullPage:true});
 await page.evaluate(()=>window.__failEnd=true);await page.locator('header [data-action="end-quiz"]').click();assert(page.url().includes('live.html'));assert.match(await page.getByRole('alert').innerText(),/fehlgeschlagen/);
 await page.evaluate(()=>window.__failEnd=false);await page.locator('header [data-action="end-quiz"]').click();await page.waitForURL('**/apps/quiz-studio/index.html');
 await page.goto(base+'/apps/jeopardy/index.html');await page.locator('[data-action="duplicate"]').click();await page.waitForFunction(()=>window.__calls.some(c=>c.name==='save_teacher_library'));
 const games=await page.evaluate(()=>window.__calls.filter(c=>c.name==='save_teacher_library').at(-1).args.p_payload.games);assert.equal(games.length,2);assert.notEqual(games[0].id,games[1].id);assert.equal(games[1].name,'Original (Kopie)');assert.deepEqual(games[0].cells,games[1].cells);
 assert.deepEqual(errors,[]);console.log('PASS: free preview navigation, retained answers/results, pin editing and circle geometry, mobile/keyboard participation, hidden/revealed target, colored pins, failed/successful session end, Jeopardy duplicate');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
