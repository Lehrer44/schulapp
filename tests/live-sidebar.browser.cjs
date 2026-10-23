// Layout regression using the actual page styles, without live accounts or data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
function styles(file){const html=fs.readFileSync(path.join(root,file),'utf8');return {body:html.match(/<body([^>]*)>/)?.[1]||'',css:[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')+'\n'+[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>fs.readFileSync(path.resolve(root,path.dirname(file),m[1].split(/[?#]/)[0]),'utf8')).join('\n')};}
const cases=[
 ['classic','apps/quiz-studio/live.html','layout','main-col','side-col','panel ranking-panel'],
 ['speed','apps/quiz-studio/live.html','layout','main-col','side-col','panel ranking-panel'],
 ['buzzer','apps/quiz-studio/live.html','layout','main-col','side-col','panel ranking-panel'],
 ['classic-student','apps/quiz-studio/student.html','layout','main','side','panel'],
 ['bluff','apps/quiz-studio/bluff/live.html','bluff-grid','panel','bluff-stack','panel'],
 ['bluff-student','apps/quiz-studio/bluff/student.html','bluff-grid bluff-player-grid','panel bluff-player-main','bluff-stack bluff-player-standings','panel'],
 ['yesno','apps/quiz-studio/yesno/live.html','yn-grid','panel','','panel'],
 ['yesno-student','apps/quiz-studio/yesno/student.html','yn-grid','panel','','panel'],
 ['survey','apps/umfrage/live.html','session','main','participants','']
];
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 for(const width of [1280,390])for(const [name,file,grid,main,side,card] of cases){
  const page=await browser.newPage({viewport:{width,height:720}}),{body,css}=styles(file);
  for(const count of [3,80]){
   const rows=Array.from({length:count},(_,i)=>'<div style="padding:12px;border-bottom:1px solid #ccc">Person '+(i+1)+'</div>').join('');
   const ranking=card?'<section class="'+card+'"><h2>Punktestand</h2>'+rows+'</section>':'<h2>Teilnehmer</h2><div class="participantList">'+rows+'</div>';
   const extra=['bluff','speed','buzzer'].includes(name)?'<section class="panel"><h2>Spielstatus</h2><p>Weitere Informationen</p></section>':'';
   await page.setContent('<html><head><style>'+css+'</style></head><body '+body+'><div id="app" class="wrap yn-main"><header style="height:180px">Spiel</header><div class="'+grid+'"><section class="'+main+'" style="min-height:2400px">Frage</section><aside class="'+side+(name==='bluff-student'?'':' live-sidebar')+'" tabindex="0">'+ranking+extra+'</aside></div></div><footer style="height:200px"></footer></body></html>');

   if(name==='bluff-student'||name==='classic-student'&&width<=740){
    const aside=page.locator(name==='bluff-student'?'.bluff-player-standings':'.side.live-sidebar'),card=aside.locator('section').first();
    assert.equal(await aside.evaluate(el=>getComputedStyle(el).position),'static','Player list follows page scrolling');
    assert(await card.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'All player names fit naturally at '+width);
    const order=await page.evaluate(()=>{
     const question=document.querySelector('.bluff-player-main,.layout>.main').getBoundingClientRect(),list=document.querySelector('.bluff-player-standings,.layout>.side').getBoundingClientRect();
     return list.top>=question.bottom;
    });
    assert(order,'Active player card comes before standings');
    if(count===80){
     await card.locator('div').last().scrollIntoViewIfNeeded();
     assert(await card.locator('div').last().isVisible(),'Last of 80 names is reachable by scrolling the page');
     assert.equal(await card.evaluate(el=>el.scrollTop),0,'No scrolling within the ranking card');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Player list fits viewport');
    continue;
   }
   const aside=page.locator('.live-sidebar');await aside.evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY+120));
   const box=await aside.boundingBox();assert(Math.abs(box.y-16)<2,name+' '+width+' sticky top: '+box.y);assert(box.height<=690,name+' sidebar fits viewport');
   const target=card?aside.locator('section').first():aside;
   if(count===80){assert(await target.evaluate(el=>el.scrollHeight>el.clientHeight),name+' card scrolls');await target.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await target.evaluate(el=>el.scrollTop>0),name+' list reachable');assert((await aside.boundingBox()).y>=15,name+' keeps anchor while scrolling inside');}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' no horizontal overflow');
  }
  await page.close();
 }
 // Jeopardy already uses a viewport-filling game screen; many teams must not hide the board.
 for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:720}}),{body,css}=styles('apps/jeopardy/index.html');await page.setContent('<style>'+css+'</style><body '+body+' class="play-screen"><main id="app"><header class="top">Jeopardy</header><div class="scorebar" tabindex="0">'+Array.from({length:80},(_,i)=>'<div class="team">Team '+i+'<div class="score">10</div></div>').join('')+'</div><section class="panel board-wrap">Spielfeld</section></main></body>');assert(await page.locator('.scorebar').evaluate(el=>el.scrollHeight>el.clientHeight));assert((await page.locator('.board-wrap').boundingBox()).height>200);await page.close();}
 console.log('PASS: sticky scores/participants, short and long lists, independent card scroll, desktop/mobile, all quiz formats and Jeopardy');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

