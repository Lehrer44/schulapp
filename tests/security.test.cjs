const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
for(const f of fs.readdirSync(root).filter(x=>x.endsWith('.html')))for(const m of read(f).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1],{filename:f});
const jeopardy=read('Jeopardy.html');
const helpers=jeopardy.slice(jeopardy.indexOf('function safeMediaData('),jeopardy.indexOf('function packGames('));
const ctx=vm.createContext({uid:()=> 'safe-id'});vm.runInContext(helpers,ctx);
for(const [type,mime] of [['image','png'],['audio','mpeg'],['video','mp4']])assert.equal(ctx.safeMediaData(type,`data:${type}/${mime};base64,AAAA`),`data:${type}/${mime};base64,AAAA`);
for(const bad of ['x" onerror="alert(1)','javascript:alert(1)','data:image/svg+xml;base64,AAAA','https://example.com/x','data:image/png;base64,AAAA" onerror="alert(1)'])assert.equal(ctx.safeMediaData('image',bad),'');
const game=ctx.normalizeGame({id:'x" onclick="alert(1)',rows:1,cols:1,cells:{'0,0':{type:'image',data:'x" onerror="alert(1)'}}});assert.equal(game.id,'safe-id');assert.equal(game.cells['0,0'].data,'');
assert(!/\+ c\.data \+/.test(jeopardy));
for(const f of ['student.html','umfrage-live.html'])assert(!read(f).includes('teacher_control'),f+' must not trust or publish broadcast controls');
assert(!read('student.html').includes("db.from('responses').insert"));
assert(read('quiz-student.html').includes('quiz_live_submit_response_secure'));

const media=read('umfrage.html');const mediaFunctions=media.slice(media.indexOf('let mediaBusy=false;'),media.indexOf('async function start(){'));
async function mediaScenario({saveOk=true,removeTarget=false}={}){
 let complete;const upload=new Promise(resolve=>complete=resolve);
 const original={media:{path:'old-version'}};const other={};const slides=[original,other];const states=[],messages=[];let removed=0,stored=0;
 const context=vm.createContext({slides,activeSlide:0,crypto:{randomUUID:()=> 'new-version'},toast:x=>messages.push(x),setSaveState:x=>states.push(x),ensureSurveySaved:async()=>({id:'survey'}),requireUser:async()=>({id:'teacher'}),renderEditor(){},renderPreview(){},persistSurvey:async()=>{stored++;return saveOk?{}:null},db:{storage:{from:()=>({upload:()=>upload,getPublicUrl:()=>({data:{publicUrl:'url-new-version'}}),remove:()=>{removed++;throw Error('Historical files must not be removed')}})}}});
 vm.runInContext(mediaFunctions,context);
 const work=context.uploadMedia({name:'image.png',type:'image/png',size:1024});await new Promise(resolve=>setImmediate(resolve));
 context.activeSlide=1;if(removeTarget)slides.shift();complete({data:{path:'new-version'},error:null});await work;
 assert.equal(removed,0);assert.equal(other.media,undefined);
 if(removeTarget){assert.equal(stored,0);assert.equal(original.media.path,'old-version');}
 else{assert.equal(original.media.path,'new-version');assert.equal(stored,1);if(!saveOk)assert.equal(states.at(-1),'Speichern erforderlich');}
}
(async()=>{await mediaScenario();await mediaScenario({saveOk:false});await mediaScenario({removeTarget:true});console.log('PASS: syntax, hostile imports, broadcast removal, protected RPCs, upload navigation/removal/save failure');})().catch(e=>{console.error(e);process.exitCode=1});
