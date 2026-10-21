// Real styles and markup, with scripts disabled so no production data is accessed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/html');
 let content=fs.readFileSync(file,'utf8');
 if(file.endsWith('.html'))content=content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 res.end(content);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [360,390,768,1280]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
   await page.evaluate(()=>{document.querySelector('#teacherApps').hidden=false;document.querySelector('#hubAccess').hidden=true;});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Hub fits '+width);
   assert((await page.locator('.header').boundingBox()).height<130,'Compact header');
   const card=await page.locator('a.app-card').first().boundingBox();
   assert(card.height<300,'Cards no longer force a 320px minimum');
   assert(await page.locator('.account-action').first().evaluate(el=>el.getBoundingClientRect().height>=44),'Touch action height');
   if(width===390||width===1280){fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,`test-results/hub-compact-${width}.png`),fullPage:true});}
   await page.goto(`http://127.0.0.1:${server.address().port}/apps/umfrage/index.html`);
   await page.evaluate(()=>{
    document.querySelector('#surveyList').innerHTML='<article class="item"><div><div class="itemName">Eine lange Unterrichtseinheit mit ausführlichem Namen</div><div class="itemMeta">12 Fragen</div></div><div class="actions"><button class="btn">Bearbeiten</button><button class="btn">Starten</button></div></article>';
   });
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Studio fits '+width);
   const sizes=await page.locator('.studio-header').evaluate(el=>{const s=getComputedStyle(el);return [parseFloat(s.paddingBottom),parseFloat(s.marginBottom)];});
   assert.deepEqual(sizes,[8,12]);
   assert(await page.locator('.item').first().evaluate(el=>getComputedStyle(el).padding==='12px'));
   for(const btn of await page.locator('.item button').all())assert((await btn.boundingBox()).height>=44);
   if(width===390||width===1280)await page.screenshot({path:path.join(root,`test-results/hub-studio-compact-${width}.png`),fullPage:true});
   await page.close();
  }
  console.log('PASS: compact headers/cards, touch targets and no horizontal overflow at 360/390/768/1280px');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
