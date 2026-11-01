(function(){
 'use strict';
 const {esc,error,rpc,dialog}=window.YesNo;
 const client=supabase.createClient('https://mqtcwiiawmuxrpkjfrfc.supabase.co','sb_publishable_eY5NBW8EJHuyO2Ic5S3HBQ_tSwErhp-');
 const app=document.getElementById('app'),notice=document.getElementById('appMessage'),mode=document.body.dataset.yesnoMode,params=new URLSearchParams(location.search);
 const call=(name,args)=>rpc(client,name,args),isHost=mode==='host';
 let state=null,room=params.get('session'),credentials=null,channel=null,poll=null,tick=null,refreshBusy=false,refreshAgain=false,actionBusy=false,signature='',serverOffset=0;
 let draftRound=null,draftAnswer=null,draftEstimate=null,questions=[],editing=null;
 function say(text,success=false){notice.textContent=text;notice.classList.toggle('yn-success',success);}
 function header(title,actions=''){return '<header class="yn-heading"><div><span class="yn-tag">JA ODER NEIN</span><h1>'+esc(title)+'</h1></div><div class="yn-actions">'+actions+'</div></header>';}
 function rules(){return '<p class="muted">'+(state?.reveal_answers?'Die eigenen Antworten werden bei der Auswertung aufgedeckt.':'Die eigene Antwort bleibt privat.')+' Schätze die Zahl aller Ja-Stimmen inklusive deiner eigenen.</p><ul class="yn-rules"><li>Genau richtig: '+(state?.exact_points??3)+' Punkte.</li><li>Bis zu '+(state?.tolerance??1)+' Personen daneben: '+(state?.near_points??1)+' Punkte.</li><li>Sonst oder ohne Abgabe: 0 Punkte.</li></ul>';}
 async function requireTeacher(){
  const {data,error:failure}=await client.auth.getUser();
  if(failure||!data?.user){location.href='../../../login.html?next=apps%2Fquiz-studio%2Findex.html';return false;}return true;
 }
 function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function storageKey(code){return 'yesno.credentials.v1:'+code;}
 function readCredentials(code){try{const c=JSON.parse(sessionStorage.getItem(storageKey(code))||'null');return c&&/^[a-f0-9]{64}$/.test(c.token)?c:null;}catch{return null;}}
 function storeCredentials(code){try{sessionStorage.setItem(storageKey(code),JSON.stringify(credentials));}catch{}}
 function playerArgs(){return {p_session_id:room,p_player_id:credentials.player,p_token:credentials.token};}

 async function loadQuestions(){const data=await call('yesno_question_list');questions=data.questions||[];renderLibrary();}
 function renderLibrary(){
  app.innerHTML=header('Deine Fragen','<a class="btn" href="../index.html">← Quiz Studio</a><button class="yn-primary" data-action="new-question">+ Neue Frage</button>')+
   '<section class="panel"><p class="muted">Erstelle Fragen und ordne sie frei benannten Fragenpaketen zu. Änderungen an Startfragen gelten nur für dein Konto.</p><div id="ynQuestionRows">'+(questions.length?questions.map(q=>'<article class="yn-question-row" data-question-id="'+q.id+'"><div><h3>'+esc(q.question)+'</h3><span class="yn-tag">'+esc(q.pack)+'</span></div><div class="yn-actions"><button data-action="edit-question" data-id="'+q.id+'">Bearbeiten</button><button data-action="delete-question" data-id="'+q.id+'">Löschen</button></div></article>').join(''):'<p>Noch keine Fragen. Erstelle deine erste Frage.</p>')+'</div></section>';
  app.querySelector('[data-action="new-question"]').onclick=()=>openQuestion(null);
  app.querySelectorAll('[data-action="edit-question"]').forEach(b=>b.onclick=()=>openQuestion(questions.find(q=>q.id===Number(b.dataset.id))));
  app.querySelectorAll('[data-action="delete-question"]').forEach(b=>b.onclick=async()=>{if(actionBusy||!confirm('Diese Frage aus deiner Sammlung löschen?'))return;actionBusy=true;b.disabled=true;try{await call('yesno_question_delete',{p_id:Number(b.dataset.id)});await loadQuestions();say('Frage gelöscht.',true);}catch(e){say(error(e));}finally{actionBusy=false;b.disabled=false;}});
 }
 function openQuestion(q){
  editing=q;const d=dialog(q?'Frage bearbeiten':'Neue Frage',
   '<form id="ynQuestionForm"><label>Frage<textarea name="question" maxlength="500" rows="4" required>'+esc(q?.question||'')+'</textarea></label><label>Fragenpaket<input name="pack" list="ynPackNames" maxlength="60" value="'+esc(q?.pack||'Eigene Fragen')+'" required></label><datalist id="ynPackNames">'+[...new Set(questions.map(x=>x.pack))].map(p=>'<option value="'+esc(p)+'"></option>').join('')+'</datalist><p role="status" class="yn-error"></p><div class="studio-actions"><button type="button" data-cancel>Abbrechen</button><button class="studio-primary" type="submit">Speichern</button></div></form>');
  d.querySelector('[data-cancel]').onclick=()=>d.close();let saving=false;
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();if(saving)return;saving=true;e.submitter.disabled=true;try{const f=e.target;await call('yesno_question_save',{p_id:editing?.id||null,p_question:f.elements.question.value.trim(),p_pack:f.elements.pack.value.trim()});d.close();await loadQuestions();say('Frage gespeichert.',true);}catch(err){d.querySelector('[role="status"]').textContent=error(err);}finally{saving=false;e.submitter.disabled=false;}};
 }
 function renderJoin(){
  document.body.classList.remove('yn-in-lobby','yn-in-game');
  const code=(params.get('code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5),saved=readCredentials(code);
  app.innerHTML='<section class="panel"><h2>Dem Spiel beitreten</h2><form id="ynJoinForm"><label>Raum-Code<input name="code" value="'+esc(code)+'" minlength="5" maxlength="5" pattern="[A-Za-z0-9]{5}" autocapitalize="characters" autocomplete="off" required></label><label>Dein Name<input name="playerName" maxlength="40" autocomplete="nickname" value="'+esc(saved?.name||'')+'" required></label><button class="yn-primary yn-submit" type="submit">Beitreten</button></form><p class="muted">'+(state?'':'Antworte geheim mit Ja oder Nein und schätze, wie viele in der Gruppe Ja sagen.')+'</p></section>';
  const form=app.querySelector('form');form.elements.code.oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
  form.onsubmit=async e=>{
   e.preventDefault();if(actionBusy)return;actionBusy=true;e.submitter.disabled=true;say('');
   const code=form.elements.code.value.toUpperCase(),name=form.elements.playerName.value.trim();
   credentials=readCredentials(code)||{token:token(),name};credentials.name=name;storeCredentials(code);
   try{
    const data=await call('yesno_join',{p_code:code,p_name:name,p_token:credentials.token});
    credentials={...credentials,session:data.session_id,player:data.player_id,name:data.name,code:data.join_code};room=data.session_id;storeCredentials(code);
    const url=new URL(location.href);url.searchParams.set('code',code);history.replaceState(null,'',url);signature='';await refresh();connect();
   }catch(err){say(error(err));}finally{actionBusy=false;e.submitter.disabled=false;}
  };
 }
 function joinLink(){const u=new URL('../../../join.html',location.href);u.searchParams.set('kind','yesno');u.searchParams.set('code',state.join_code);return u.href;}
 function participation(){
  const url=joinLink(),d=dialog('Teilnahme','<div class="yn-code">'+esc(state.join_code)+'</div><div class="yn-qr"></div><p class="yn-participation-link"><a class="btn yn-join-link" target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">Teilnahmeseite öffnen</a></p>');
  if(state.phase==='lobby')d.classList.add('yn-lobby-dialog');
  drawQr(d.querySelector('.yn-qr'),url);
 }
 function drawQr(qr,url){
  qr.setAttribute('aria-label','QR-Code zum Beitreten');qr.setAttribute('role','img');
  if(typeof window.QRCode==='function'){new QRCode(qr,{text:url,width:240,height:240,correctLevel:QRCode.CorrectLevel.M});qr.removeAttribute('title');}
 }
 function answerForm(){
  if(state.own_answer)return '<div class="yn-tag">✓ Deine Antwort wurde gespeichert</div><p>Nur für dich: <strong>'+ (state.own_answer.answer?'JA':'NEIN')+'</strong> · Schätzung: <strong>'+state.own_answer.estimate+'</strong></p><p class="muted">Warte auf die Auswertung. Die Abgabe ist verbindlich.</p>';
  const n=state.player_count;
  return '<form id="ynAnswerForm"><div class="yn-answer-buttons" role="group" aria-label="Deine geheime Antwort"><button type="button" class="yn-answer" data-answer="yes" aria-pressed="'+(draftAnswer===true)+'">JA</button><button type="button" class="yn-answer" data-answer="no" aria-pressed="'+(draftAnswer===false)+'">NEIN</button></div><fieldset class="yn-estimate"><legend>Wie viele sagen JA?</legend><output id="ynEstimateValue" aria-label="Deine Schätzung" aria-live="polite" '+(draftEstimate===null?'hidden':'')+'>'+(draftEstimate??'')+'</output>'+
   '<div class="yn-numbers" role="group" aria-label="Geschätzte Anzahl der Ja-Stimmen">'+Array.from({length:n+1},(_,i)=>'<button type="button" data-estimate="'+i+'" aria-pressed="'+(draftEstimate===i)+'">'+i+'</button>').join('')+'</div>'+
   '</fieldset><button class="yn-primary yn-submit" type="submit" disabled>Geheim abgeben</button></form>';
 }
 function results(){
  const n=state.player_count,yes=state.yes_count,no=state.no_count,missing=n-yes-no;
  return '<div class="yn-result-hero yn-pop"><span class="yn-total">'+yes+'</span><strong>von '+n+' sagen JA</strong><div class="yn-distribution yn-bar-enter" role="img" aria-label="'+yes+' Ja, '+no+' Nein, '+missing+' ohne Abgabe"><span class="yes" style="width:'+100*yes/n+'%"></span><span class="no" style="width:'+100*no/n+'%"></span><span class="missing" style="width:'+100*missing/n+'%"></span></div><div class="yn-legend"><span>● JA: '+yes+'</span><span>● NEIN: '+no+'</span>'+(missing?'<span>Ohne Abgabe: '+missing+'</span>':'')+'</div></div><h2>Die Schätzungen</h2>'+state.results.map(r=>'<div class="yn-result-row '+(r.exact?'exact yn-pop':'')+'"><strong>'+esc(r.name)+(state.reveal_answers&&typeof r.answer==='boolean'?' <span class="yn-revealed-answer '+(r.answer?'is-yes':'is-no')+'">('+(r.answer?'JA':'NEIN')+')</span>':'')+(r.exact?' · Volltreffer!':'')+'</strong><span>'+(r.estimate===null?'Keine Abgabe':'Tipp: '+r.estimate)+'</span><span class="yn-points">+'+r.points+'</span></div>').join('')+(isHost&&!state.reveal_answers?'<p class="muted">Persönliche Ja/Nein-Antworten werden nicht veröffentlicht.</p>':'');
 }
 function scoreboard(){
  const terminal=['finished','ended'].includes(state.phase);
  const rows=state.players.map((p,i)=>{
   const submitted=state.phase==='question'&&p.submitted;
   const rank=terminal?1+state.players.filter(other=>Number(other.score)>Number(p.score)).length:i+1;
   return '<div class="yn-score yn-lobby-score '+(p.id===credentials?.player?'me ':'')+(submitted?'has-vote':'')+'" data-player-id="'+esc(p.id)+'"><span>'+rank+'</span><strong class="yn-score-name">'+esc(p.name)+(submitted?'<span class="yn-vote-mark" role="img" aria-label="Stimme abgegeben" title="Stimme abgegeben">✓</span>':'')+'</strong><b>'+p.score+' P</b></div>';
  }).join('');
  return '<section class="panel yn-lobby-ranking"><h2>Rangliste</h2>'+(rows?'<div class="yn-lobby-score-list">'+rows+'</div>':'<div class="yn-lobby-empty">noch keine Teilnehmer</div>')+'</section>';
 }
 function gameHeader(actions){return isHost?'<header class="studio-header"><div class="studio-identity"><span class="studio-icon" aria-hidden="true">⧉</span><h1 class="studio-title">Ja oder <span>Nein</span></h1></div><div class="studio-actions">'+actions+'</div></header>':'';}
 function renderLobby(){
  const allReady=state.players.length>=2&&state.players.every(p=>p.ready);
  const heading=gameHeader('<button data-action="participation">Teilnahme</button><button class="yn-lobby-end" data-action="end">Beenden</button>');
  const main=isHost?'<div class="yn-lobby-main"><button type="button" class="panel yn-lobby-start" data-action="start" '+(!allReady?'disabled':'')+'>Spiel starten</button><section class="panel yn-lobby-rules"><h2>Punkte sammeln</h2>'+rules()+'</section></div>':'<section class="panel yn-lobby-rules"><h2>Wartelobby</h2><p>Du bist dabei. Die Spielleitung gibt gleich die erste Frage frei.</p>'+rules()+'</section>';
  app.innerHTML=heading+'<div class="yn-lobby-grid'+(!isHost?' yn-lobby-player':'')+'">'+main+'<aside class="'+(isHost?'live-sidebar':'yn-lobby-standings')+'" '+(isHost?'tabindex="0" ':'')+'aria-label="Rangliste">'+scoreboard()+'</aside></div>';
  app.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>gameAction(b.dataset.action));
 }
 function renderGame(){
  document.body.classList.add('yn-in-game');
  document.body.classList.toggle('yn-in-lobby',state.phase==='lobby');
  if(state.phase==='lobby'){renderLobby();return;}
  if(draftRound!==state.round_index){draftRound=state.round_index;draftAnswer=null;draftEstimate=null;}
  if(state.own_answer){draftAnswer=state.own_answer.answer;draftEstimate=state.own_answer.estimate;}
  const phase=state.phase,terminal=['finished','ended'].includes(phase),actions=!terminal?'<button class="yn-lobby-end" data-action="end">Beenden</button>':'<a class="btn" href="../index.html">Quiz Studio</a>';
  let content='';
  if(phase==='ended'){
   content='<h2>Spiel beendet</h2><p>Die bereits vergebenen Punkte bleiben erhalten. Eine abgebrochene Runde wird nicht gewertet.</p>';
  }else{
   const roundLabel='Runde '+(state.round_index+1)+'/'+state.round_count;
   content='<div class="yn-heading"><span class="yn-tag">'+roundLabel+'</span>'+(phase==='question'?'<span class="yn-clock" id="ynCountdown" role="timer" aria-label="Verbleibende Zeit"></span>':'<span class="yn-tag">Auswertung</span>')+'</div>'+((isHost||phase==='question')?'<h2 class="yn-question">'+esc(state.question)+'</h2>':'');
   if(phase==='question'){if(!isHost)content+=answerForm();}
   else{
    if(phase==='finished'){
     const top=state.players[0]?.score??0,winners=state.players.filter(p=>p.score===top);
     content+='<div class="yn-podium yn-pop"><span aria-hidden="true">🏆</span><h2>'+(winners.length===1?'Gewonnen: ':'Gemeinsamer Sieg: ')+winners.map(p=>esc(p.name)).join(', ')+'</h2><p>'+top+' Punkte · Alle '+state.round_count+' Runden sind gespielt.</p></div>';
    }
    content+=results();
    if(isHost&&phase==='result')content+='<div class="yn-actions"><button class="yn-primary" data-action="next">Nächste Runde</button></div>';
   }
  }
  app.innerHTML=gameHeader(actions)+'<div class="yn-grid'+(!isHost?' yn-player-grid':'')+'"><section class="panel yn-game-main">'+content+'</section><aside class="'+(isHost?'live-sidebar':'yn-player-standings')+'" '+(isHost?'tabindex="0" ':'')+'aria-label="Rangliste">'+scoreboard()+'</aside></div>';
  app.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>gameAction(b.dataset.action));bindAnswers();updateClock();
 }
 function bindAnswers(){
  const form=app.querySelector('#ynAnswerForm');if(!form)return;
  const output=form.querySelector('output'),submit=form.querySelector('[type="submit"]');
  function update(){
   form.querySelectorAll('[data-answer]').forEach(b=>b.setAttribute('aria-pressed',String(draftAnswer===(b.dataset.answer==='yes'))));
   form.querySelectorAll('[data-estimate]').forEach(b=>b.setAttribute('aria-pressed',String(draftEstimate===Number(b.dataset.estimate))));
   output.hidden=draftEstimate===null;output.textContent=draftEstimate??'';
   submit.disabled=actionBusy||draftAnswer===null||draftEstimate===null||secondsLeft()<=0;
  }
  const estimate=v=>{const n=Number(v);draftEstimate=v!==''&&Number.isInteger(n)&&n>=0&&n<=state.player_count?n:null;update();};
  form.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{draftAnswer=b.dataset.answer==='yes';update();});
  form.querySelectorAll('[data-estimate]').forEach(b=>b.onclick=()=>estimate(b.dataset.estimate));
  update();
  form.onsubmit=async e=>{
   e.preventDefault();if(actionBusy||draftAnswer===null||draftEstimate===null)return;
   actionBusy=true;submit.disabled=true;say('Antwort wird gespeichert …');
   try{await call('yesno_submit',{...playerArgs(),p_round:state.round_index,p_answer:draftAnswer,p_estimate:draftEstimate});say('✓ Geheim gespeichert.',true);signature='';}
   catch(err){say(error(err));}finally{actionBusy=false;await refresh();if(form.isConnected)update();}
  };
 }
 async function gameAction(action){
  if(action==='participation'){participation();return;}if(actionBusy)return;
  if(action==='end'&&!confirm('Spiel beenden? Die laufende Runde erhält keine Punkte.'))return;
  actionBusy=true;app.querySelectorAll('button[data-action]').forEach(b=>b.disabled=true);say('');
  try{
   await call('yesno_host_action',{p_session_id:room,p_round:state.round_index,p_phase:state.phase,p_action:action});
   signature='';
  }catch(err){say(error(err));}finally{actionBusy=false;signature='';await refresh();}
 }
 function secondsLeft(){return state?.deadline?Math.max(0,Math.ceil((Date.parse(state.deadline)-(Date.now()+serverOffset))/1000)):0;}
 function updateClock(){
  const clock=document.getElementById('ynCountdown');if(!clock)return;const secs=secondsLeft();clock.textContent=secs+' s';clock.classList.toggle('expired',secs===0);
  if(secs===0){const submit=app.querySelector('#ynAnswerForm [type="submit"]');if(submit)submit.disabled=true;}
 }
 async function refresh(){
  if(!room)return;if(refreshBusy){refreshAgain=true;return;}refreshBusy=true;
  try{
   let started=Date.now(),data=await call(isHost?'yesno_host_state':'yesno_player_state',isHost?{p_session_id:room}:playerArgs());
   if(!isHost&&data.phase==='lobby'&&data.players.some(p=>p.id===credentials.player&&!p.ready)){
    try{await call('yesno_ready',{...playerArgs(),p_ready:true});}
    catch(e){if(e.code!=='PHASE_CHANGED')throw e;}
    started=Date.now();data=await call('yesno_player_state',playerArgs());
   }
   serverOffset=Date.parse(data.server_now)-(started+Date.now())/2;state=data;
   const next=[data.session_id,data.revision,data.phase,data.round_index].join(':');if(next!==signature){signature=next;renderGame();}
   setConnectionStatus('ready',data.phase==='lobby'?'Mit Supabase verbunden':'Verbunden · Spielstand aktualisiert.');
  }catch(err){
   setConnectionStatus('error','Verbindung unterbrochen. Wir versuchen es automatisch erneut.');
   if(!isHost&&err.code==='INVALID_PARTICIPANT_TOKEN'){clearInterval(poll);if(channel)client.removeChannel(channel);room=null;renderJoin();}
   say(error(err));
  }finally{refreshBusy=false;if(refreshAgain){refreshAgain=false;queueMicrotask(refresh);}}
 }
 function connect(){
  if(!room)return;if(channel)client.removeChannel(channel);channel=client.channel('yesno-signal-'+room).on('postgres_changes',{event:'UPDATE',schema:'public',table:'yesno_live_signals',filter:'session_id=eq.'+room},()=>refresh()).subscribe(status=>{if(status==='SUBSCRIBED')refresh();});
  clearInterval(poll);clearInterval(tick);poll=setInterval(refresh,1500);tick=setInterval(updateClock,250);
 }
 window.addEventListener('online',()=>refresh());window.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('pagehide',()=>{if(channel)client.removeChannel(channel);clearInterval(poll);clearInterval(tick);});
 window.addEventListener('pageshow',e=>{if(e.persisted&&room){connect();refresh();}});
 (async()=>{
  try{
   if(mode==='library'){if(await requireTeacher())await loadQuestions();}
   else if(isHost){if(!await requireTeacher())return;if(!room)throw Error('Wähle zuerst ein Spiel im Quiz Studio.');await refresh();connect();}
   else{
    const code=(params.get('code')||'').toUpperCase();credentials=readCredentials(code);
    if(credentials?.session&&credentials?.player){room=credentials.session;await refresh();if(room)connect();}else renderJoin();
   }
  }catch(err){say(error(err));app.innerHTML='<section class="panel"><h1>Spiel konnte nicht geladen werden</h1><p>Bitte lade die Seite erneut.</p></section>';}
  finally{app.removeAttribute('aria-busy');}
 })();
})();
