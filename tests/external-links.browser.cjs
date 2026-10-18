// Actual PostgreSQL/RLS behind a local test-only bridge. No live credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const teacher='11111111-1111-4111-8111-111111111111',quote=s=>"'"+String(s).replace(/'/g,"''")+"'";
function sql(query){return execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',env:process.env}).trim().split('\n').filter(Boolean).at(-1);}
sql('insert into auth.users(id) values('+quote(teacher)+') on conflict do nothing');
const server=http.createServer(async(req,res)=>{
 if(req.url==='/links'){let raw='';for await(const c of req)raw+=c;const {action,payload,host,id,owner}=JSON.parse(raw);try{
  const prefix='begin;'+(host?"select set_config('request.jwt.claim.sub',"+quote(teacher)+",true);set local role authenticated;":'set local role anon;');let query;
  if(action==='load')query='select coalesce(json_agg(x),\'[]\') from (select id,name,url from public.teacher_external_links where owner_id='+quote(owner)+' order by created_at,id) x';
  else if(action==='insert')query='with added as (insert into public.teacher_external_links(owner_id,name,url) values('+[payload.owner_id,payload.name,payload.url].map(quote).join(',')+') returning id,name,url) select row_to_json(added) from added';
  else if(action==='delete')query='with removed as (delete from public.teacher_external_links where owner_id='+quote(owner)+' and id='+quote(id)+' returning id) select coalesce(json_agg(removed),\'[]\') from removed';
  else throw Error('Unsupported action');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:JSON.parse(sql(prefix+query+';commit;'))}));
 }catch(e){res.end(JSON.stringify({error:{message:e.message}}));}return;}
 const name=decodeURIComponent(new URL(req.url,'http://test').pathname).replace(/^\/SchulApp/,'');const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/SchulApp',browser=await chromium.launch({args:['--no-sandbox']}),errors=[];let context;
 try{
 context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(teacher=>{window.__signedIn=true;window.supabase={createClient:()=>({auth:{async getUser(){return {data:{user:window.__signedIn?{id:teacher}:null}}},async signOut(){window.__signedIn=false;return {error:null}}},from(table){if(table!=='teacher_external_links')throw Error('Unexpected table');let action='load',payload,id,owner;const q={select(){return q},eq(k,v){if(k==='owner_id')owner=v;if(k==='id')id=v;return q},order(){return q},insert(v){action='insert';payload=v;return q},delete(){action='delete';return q},single(){return q},async then(resolve,reject){try{const r=await fetch('/links',{method:'POST',body:JSON.stringify({action,payload,id,owner,host:window.__signedIn})});return resolve(await r.json());}catch(e){return reject(e);}}};return q}})};},teacher);
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'/index.html');const card=page.locator('#externalLinks');await card.getByText('Noch keine Links.',{exact:true}).waitFor();assert.equal(await page.locator('.app-card').count(),4);
 await card.locator('[data-links-add]').click();await card.locator('[name="linkName"]').fill('Lernportal');await card.locator('[name="linkUrl"]').fill('https://example.org/lernen');await card.locator('[type="submit"]').click();await card.getByText('Lernportal',{exact:true}).waitFor();
 const link=card.locator('.external-link-open');assert.equal(await link.getAttribute('href'),'https://example.org/lernen');assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
 await page.reload();await card.getByText('Lernportal',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'external-links-desktop.png'),fullPage:true});
 await card.locator('[data-links-add]').click();await card.locator('[name="linkName"]').fill('<img src=x onerror=alert(1)>');await card.locator('[name="linkUrl"]').fill('javascript:alert(1)');await card.locator('[type="submit"]').click();await card.getByText('Bitte gib einen Namen und eine gültige Adresse mit https:// oder http:// ein.',{exact:true}).waitFor();assert.equal(await card.locator('.external-link-row').count(),1);assert.equal(await card.locator('img').count(),0);
 await card.locator('[name="linkUrl"]').fill('https://example.net/sicher');await card.locator('[type="submit"]').click();await card.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();assert.equal(await card.locator('img').count(),0);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'external-links-mobile.png'),fullPage:true});
 await card.locator('.external-link-row').filter({hasText:'<img'}).locator('button').click();await card.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor({state:'detached'});await card.locator('.external-link-remove').click();await card.getByText('Noch keine Links.',{exact:true}).waitFor();await page.reload();await card.getByText('Noch keine Links.',{exact:true}).waitFor();
 await page.locator('#logoutBtn').click();await page.locator('#hubAccess').waitFor({state:'visible'});assert(await card.isHidden());assert.equal(await card.locator('.external-link-row').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: PostgreSQL-backed dashboard links, reload persistence, safe names/URLs, delete, private logout, desktop and mobile');
 }finally{await context?.close();await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
