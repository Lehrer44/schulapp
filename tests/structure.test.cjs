const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const routes={
 'dashboard.html':'apps/umfrage/index.html','umfrage.html':'apps/umfrage/editor.html',
 'umfrage-live.html':'apps/umfrage/live.html','student.html':'apps/umfrage/student.html',
 'quiz.html':'apps/quiz-studio/index.html','quiz-live.html':'apps/quiz-studio/live.html',
 'quiz-student.html':'apps/quiz-studio/student.html','Jeopardy.html':'apps/jeopardy/index.html','teacher.html':'login.html'
};
for(const [old,target] of Object.entries(routes)){
 assert(fs.existsSync(path.join(root,target)),target);
 assert(read(old).includes('data-target="'+target+'"'),old);
 // Exercise the actual compatibility script under a GitHub Pages-style project prefix.
 let actual;const source=new URL('https://example.test/SchulApp/'+old+'?code=ABCDE&kind=quiz#resume');
 vm.runInNewContext(read('shared/legacy-route.js'),{URL,document:{currentScript:{dataset:{target}}},location:{href:source.href,search:source.search,hash:source.hash,replace:url=>actual=url}});
 assert.equal(actual,'https://example.test/SchulApp/'+target+'?code=ABCDE&kind=quiz#resume');
}
for(const file of fs.readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.html'))){
 const html=read(file);
 for(const match of html.matchAll(/\b(?:href|src)="([^"\n]+)"/g)){
  const value=match[1];
  if(!/^[\w./-]+(?:[?#][\w%=&.-]*)?$/.test(value))continue;
  assert(fs.existsSync(path.resolve(root,path.dirname(file),value.split(/[?#]/)[0])),file+': '+value);
 }
}
const hub=read('index.html');assert(hub.includes('<title>SchulApp · Haupt-Dashboard</title>'));
for(const app of ['umfrage','quiz-studio','jeopardy'])assert(hub.includes('href="apps/'+app+'/index.html"'));
assert(!hub.includes('href="join.html"'));assert(!hub.includes('href="teacher.html"'));
const survey=read('apps/umfrage/index.html');assert(!survey.includes('id="gamePanel"'));assert(!survey.includes('id="openGamesPanel"'));
assert(survey.includes('id="activeSessionList"')&&survey.includes('id="endedSessionList"'));
for(const file of ['apps/umfrage/index.html','apps/umfrage/editor.html','apps/umfrage/live.html','apps/quiz-studio/index.html','apps/quiz-studio/live.html','apps/jeopardy/index.html'])assert(read(file).includes('href="../../index.html"'),file);
for(const file of ['schema.sql','quiz_live_schema.sql','security_hardening.sql','reliability_upgrade.sql'])assert(fs.existsSync(path.join(root,'supabase',file)));
console.log('PASS: app folders, hub, survey-only dashboard, local assets, navigation, legacy query/hash redirects under project hosting');
