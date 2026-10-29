/* Supabase is authoritative for secrets, phases, deadlines and scoring. */
(function(){
 'use strict';
 const client=supabase.createClient('https://mqtcwiiawmuxrpkjfrfc.supabase.co','sb_publishable_eY5NBW8EJHuyO2Ic5S3HBQ_tSwErhp-');
 const app=document.getElementById('app'),message=document.getElementById('appMessage'),mode=document.body.dataset.bluffMode,params=new URLSearchParams(location.search);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const errors={NOT_AUTHENTICATED:'Bitte melde dich mit deinem Lehrerkonto an.',NOT_OWNER:'Dieser Bereich gehört zu einem anderen Lehrerkonto.',INVALID_QUESTION:'Gib eine Frage mit 5 bis 500 Zeichen ein.',INVALID_KIND:'Wähle einen Fragentyp.',INVALID_ROUND_COUNT:'Wähle zwischen 1 und 50 Runden.',INVALID_SELECTION:'Wähle unterschiedliche Fragen für die Runden.',NOT_ENOUGH_QUESTIONS:'Ergänze Fragen oder verringere die Rundenzahl.',NAME_TAKEN:'Dieser Name wird bereits verwendet.',GAME_ALREADY_STARTED:'Das Spiel läuft bereits. Neue Spieler können beim nächsten Spiel beitreten.',ROOM_FULL:'Der Raum ist voll (maximal 50 Personen).',INVALID_JOIN_INPUT:'Prüfe Code und Namen.',SESSION_NOT_FOUND:'Dieser Raum ist nicht mehr verfügbar.',INVALID_PARTICIPANT_TOKEN:'Die Teilnahme konnte nicht bestätigt werden. Tritt bitte erneut bei.',PHASE_CHANGED:'Die Spielphase hat sich geändert. Die Ansicht wird aktualisiert.',INVALID_ANSWER:'Gib eine Antwort mit 1 bis 180 Zeichen ein.',TEAMS_NOT_BALANCED:'Ordne alle Personen gleich großen Teams mit mindestens zwei Mitgliedern zu.',TEAM_NAME_REQUIRED:'Wähle einen Namen aus deinem eigenen Team.',ANSWER_ALREADY_CAST:'Deine Antwort wurde bereits gespeichert.',REVEAL_FIRST:'Decke zuerst alle eingereichten Antworten auf.',INVALID_POINTS:'Wähle 0, 1 oder 3 Punkte.',INVALID_TEAM:'Wähle eines der eingerichteten Teams.',INVALID_PLAYER:'Diese Person ist nicht im Raum.',INVALID_SETTINGS:'Wähle 2 bis 10 Teams und 0 bis 600 Sekunden.',JOIN_RATE_LIMITED:'Zu viele Beitrittsversuche. Warte bitte eine Minute.',INVALID_ACTION:'Diese Aktion ist in der aktuellen Phase nicht möglich.'};
 let state=null,room=params.get('session')||'',credentials=null,questions=[],busy=false,refreshing=false,channel=null,poll=null,lastSignature='',editing=null,revealedBefore=new Set();
 function setConnectionStatus(status,text){
  const el=document.getElementById('bluffConnectionStatus');if(!el)return;
  if(!navigator.onLine){status='error';text='Offline. Die Synchronisation mit Supabase ist unterbrochen.';}
  el.dataset.state=status;el.textContent=status==='ready'?'Mit Supabase verbunden':text;
 }
 window.addEventListener('offline',()=>setConnectionStatus('error','Offline. Synchronisation nicht möglich.'));
 function say(text,success=false){message.textContent=text||'';message.classList.toggle('is-success',success);}
 function errorText(e){return errors[e.message]||e.message||'Verbindung fehlgeschlagen. Bitte erneut versuchen.';}
 async function rpc(name,args={}){
  let result;
  try{result=await client.rpc(name,args);if(result.error)throw Error(result.error.message);}
  catch(e){setConnectionStatus('error','Synchronisation mit Supabase fehlgeschlagen: '+errorText(e));throw e;}
  if(result.data?.ok===false)throw Error(result.data.error||'Aktion fehlgeschlagen');return result.data;
 }
 function header(sub,actions=''){if(mode==='player')return '';return '<header class="studio-header"><div class="studio-identity"><span class="studio-icon" aria-hidden="true">⧉</span><div><h1 class="studio-title">Dieselbe <span>Antwort</span></h1>'+(sub?'<p class="bluff-subtitle">'+esc(sub)+'</p>':'')+'</div></div><div class="studio-actions">'+actions+'</div></header>';}
 function rules(){return '<ol class="bluff-rules"><li>Antwortet verdeckt und ohne Absprache auf dieselbe Frage.</li><li>Alle im Team gleich: <b>3 Punkte</b>. Mindestens ein gleiches Paar: <b>1 Punkt</b>. Sonst <b>0 Punkte</b>.</li><li>Groß-/Kleinschreibung und äußere Leerzeichen zählen nicht. Fehlende Antworten bilden kein Paar.</li><li>Bei Teamfragen sind nur Namen aus dem eigenen Team erlaubt.</li></ol>';}
 async function requireTeacher(){const {data,error}=await client.auth.getUser();if(error||!data?.user){location.href='../../../login.html?next=apps%2Fquiz-studio%2Fsame%2Findex.html';return false;}return true;}
 async function loadLibrary(){const q=await rpc('same_question_list');questions=q.questions;renderLibrary();setConnectionStatus('ready','Fragensammlung mit Supabase verbunden.');}
 function questionRows(){return questions.map(q=>'<article class="collection-row" data-question-id="'+q.id+'"><div><h3>'+esc(q.question)+'</h3><p class="bluff-help">'+(q.kind==='team'?'Teamfrage':'Assoziation')+'</p></div><div class="bluff-row"><button data-action="edit-question" data-id="'+q.id+'">Bearbeiten</button><button class="danger" data-action="delete-question" data-id="'+q.id+'">Löschen</button></div></article>').join('');}
 function renderLibrary(){
  app.setAttribute('aria-busy','false');
  app.innerHTML=header('Fragensammlung','<button class="studio-primary" data-action="new-question">＋ Frage hinzufügen</button>')+
  '<section class="panel"><div class="library-heading"><h2>Deine Fragensammlung</h2><span class="library-count">'+questions.length+' Fragen</span></div><section class="bluff-editor" id="questionEditor" hidden><h3 id="editorTitle">Neue Frage</h3><form id="questionForm"><label class="bluff-label" for="questionText">Frage</label><textarea id="questionText" class="bluff-textarea" minlength="5" maxlength="500" required></textarea><label class="bluff-label" for="questionKind">Fragentyp</label><select id="questionKind" class="bluff-select"><option value="association">Assoziation</option><option value="team">Name aus dem eigenen Team</option></select><div class="bluff-actions"><button class="studio-primary" type="submit">Frage speichern</button><button type="button" data-action="cancel-edit">Abbrechen</button></div><p id="questionSaveState" role="status"></p></form></section><div id="questionRows">'+questionRows()+'</div></section>';
  document.getElementById('questionForm').onsubmit=saveQuestion;
 }
 function openEditor(q){editing=q?.id??null;document.getElementById('questionEditor').hidden=false;document.getElementById('editorTitle').textContent=q?'Frage bearbeiten':'Neue Frage';document.getElementById('questionText').value=q?.question||'';document.getElementById('questionKind').value=q?.kind||'association';document.getElementById('questionText').focus();}
 async function saveQuestion(e){e.preventDefault();if(busy)return;busy=true;const button=e.submitter;button.disabled=true;try{await rpc('same_question_save',{p_id:editing,p_question:document.getElementById('questionText').value.trim(),p_kind:document.getElementById('questionKind').value});await loadLibrary();say('Frage gespeichert.',true);}catch(err){document.getElementById('questionSaveState').textContent=errorText(err);}finally{busy=false;button.disabled=false;}}
 function getStored(){try{return JSON.parse(sessionStorage.getItem('same.credentials.v1')||'null');}catch{return null;}}
 function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function renderJoin(){app.setAttribute('aria-busy','false');app.innerHTML=header('Mitspielen · Dieselbe Antwort')+'<div class="bluff-grid"><section class="panel"><h2>Dieselbe Antwort · Beitreten</h2><form id="joinForm"><label class="bluff-label" for="roomCode">Raum-Code</label><input class="bluff-input bluff-code" id="roomCode" maxlength="5" minlength="5" pattern="[A-Za-z0-9]{5}" required autocapitalize="characters" autocomplete="off" value="'+esc((params.get('code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5))+'"><label class="bluff-label" for="playerName">Dein Name</label><input class="bluff-input" id="playerName" maxlength="40" required autocomplete="off"><button class="bluff-primary" type="submit" style="margin-top:18px">Beitreten →</button></form></section><aside class="panel"><h2>So funktioniert es</h2>'+rules()+'</aside></div>';
 document.getElementById('roomCode').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
 document.getElementById('joinForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;e.submitter.disabled=true;try{const t=credentials?.token||token();const d=await rpc('same_join',{p_code:document.getElementById('roomCode').value,p_name:document.getElementById('playerName').value.trim(),p_token:t});credentials={session:d.session_id,player:d.player_id,token:t,name:d.name,code:d.join_code};try{sessionStorage.setItem('same.credentials.v1',JSON.stringify(credentials));}catch{}room=d.session_id;lastSignature='';say('');await refresh(true);connect();}catch(err){say(errorText(err));}finally{busy=false;e.submitter.disabled=false;}};
 }
 // Stable team colours are shared by the board, submission state and standings.
 function teamStyle(team){const colours=[['#6b9f35','#365b23','#e3f0d7'],['#4775df','#223e72','#deebf7'],['#a66bcb','#633b7d','#eee3f5'],['#c47b28','#744715','#faecd7'],['#2e9489','#205b55','#dbf0ec'],['#bd627b','#73384a','#f7e2e9'],['#7c85b4','#454d78','#e8ebf7'],['#8e8733','#56501d','#f1efd6'],['#4785a1','#285169','#dfedf5'],['#a47752','#62462e','#f3e8df']];const c=colours[(Math.max(1,team||1)-1)%colours.length];return '--team-color:'+c[0]+';--team-ink:'+c[1]+';--team-tint:'+c[2];}
 function leaderboard(){
  const teams=[...state.teams].sort((a,b)=>b.score-a.score||a.id-b.id);
  return '<div class="bluff-stack">'+teams.map(t=>'<div class="bluff-score same-score" style="'+teamStyle(t.id)+'" data-rank-team="'+t.id+'"><span class="same-rank">'+ (1+teams.filter(o=>o.score>t.score).length)+'</span><div class="same-score-team"><strong>Team '+t.id+'</strong><p>'+state.players.filter(p=>p.team===t.id).map(p=>esc(p.name)).join(' · ')+'</p></div><b>'+t.score+' P</b></div>').join('')+'</div>';
 }
 function phaseActions(){const actions={lobby:['start','Erste Frage freigeben'],answers:['close','Eingabe schließen'],reveal:['scores','Auswertung'],leaderboard:['next',state.round_index+1>=state.round_count?'Endplatzierung anzeigen':'Nächste Frage']};const a=actions[state.phase];return a?'<button class="bluff-primary" data-action="'+a[0]+'">'+a[1]+'</button>':'';}
 function roster(host){return '<div class="same-teams">'+Array.from({length:state.team_count},(_,i)=>i+1).concat(state.phase==='lobby'&&state.players.some(p=>!p.team)?[null]:[]).map(team=>{
  const members=state.players.filter(p=>p.team===team),points=state.teams.find(t=>t.id===team)?.round_points,scored=state.phase==='leaderboard'&&points!==null&&points!==undefined;
  const title=team?'Team '+team:'Noch ohne Team';
  return '<section class="same-team'+(!team?' same-unassigned':'')+'" style="'+teamStyle(team)+'" data-team="'+(team||'unassigned')+'"><header class="same-team-heading"><h3>'+title+(scored?'<span class="same-round-points"> – '+points+' '+(points===1?'Punkt':'Punkte')+'</span>':'')+'</h3>'+(host&&scored?'<div class="same-point-actions" role="group" aria-label="Punkte für '+title+' korrigieren">'+[0,1,3].filter(value=>value!==points).map(value=>'<button data-action="override" data-team="'+team+'" data-value="'+value+'" aria-label="'+title+' auf '+value+' Punkte setzen">'+value+'P</button>').join('')+'</div>':'')+'</header><div class="same-members">'+members.map(p=>{
   const revealed=Object.hasOwn(p,'answer'),submitted=p.submitted&&state.phase==='answers',canReveal=host&&state.phase==='reveal'&&p.submitted&&!revealed;
   const text=revealed?p.answer:p.name+(canReveal?' – aufdecken':'');
   return '<article class="same-person'+(submitted?' has-answer':'')+(revealed?' is-revealed'+(!revealedBefore.has(state.round_index+':'+p.id)?' same-new':''):'')+'" data-player-id="'+esc(p.id)+'" aria-label="'+esc(p.name)+(p.submitted?' · Antwort abgegeben':'')+'">'+(state.phase==='lobby'?'<strong>'+esc(p.name)+'</strong>'+(host?'<label>Team <select class="bluff-select" data-assign="'+esc(p.id)+'"><option value="">Bitte wählen</option>'+Array.from({length:state.team_count},(_,i)=>'<option value="'+(i+1)+'" '+(p.team===i+1?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></label>':''):canReveal?'<button class="same-name" data-action="reveal" data-id="'+esc(p.id)+'" aria-label="Antwort von '+esc(p.name)+' aufdecken">'+esc(text)+'</button>':'<'+(revealed?'p':'strong')+' class="'+(revealed?'same-answer':'same-name')+'">'+esc(text)+'</'+(revealed?'p':'strong')+'>')+'</article>';
  }).join('')+'</div></section>';
 }).join('')+'</div>';}
 function renderGame(){const s=state,host=mode==='host';
  // Preserve a mobile draft and selection when a different player submits.
  const input=document.getElementById('answerText'),draft=input?.value,focused=document.activeElement===input,selection=input?.selectionStart;
  let main='';
  if(s.phase==='ended')main='<h2 class="bluff-question">Endplatzierung</h2><div class="bluff-final-ranking">'+leaderboard()+'</div>';
  else if(s.phase==='lobby'){
   main='<h2>Wartelobby</h2><p>'+(host?'Ordne alle Personen gleich großen Teams zu. Jedes Team braucht mindestens zwei Mitglieder.':'Du bist dabei. Die Spielleitung ordnet die Teams zu und startet die Runde.')+'</p>';
   if(host)main+='<form id="settingsForm" class="bluff-fields"><label>Anzahl der Teams<input class="bluff-input" id="teamCount" type="number" min="2" max="10" value="'+s.team_count+'" required></label><label>Zeit pro Runde (0 = ohne Timer)<input class="bluff-input" id="timerSeconds" type="number" min="0" max="600" value="'+s.timer_seconds+'" required></label><button type="submit">Einstellungen übernehmen</button></form>';
   if(host)main+=roster(true)+rules();
  }else{
   main='<p class="bluff-help">Runde '+(s.round_index+1)+' von '+s.round_count+' · '+(s.kind==='team'?'Teamfrage':'Assoziation')+'</p><h2 class="bluff-question">'+esc(s.question)+'</h2>';
   if(s.phase==='answers'){
    main+='<p class="bluff-status" role="status">'+s.players.filter(p=>p.submitted).length+' von '+s.players.length+' haben geantwortet.</p><p id="sameTimer" class="bluff-counter"></p>';
    if(!host){const own=s.players.find(p=>p.id===credentials.player);main+=s.own_answer?'<p class="bluff-save-status">✓ Deine Antwort ist gespeichert.</p>':'<form id="answerForm"><label class="bluff-label" for="answerText">Deine verdeckte Antwort</label>'+(s.kind==='team'?'<select class="bluff-select" id="answerText" required><option value="">Name aus deinem Team wählen</option>'+s.players.filter(p=>p.team===own?.team).map(p=>'<option value="'+esc(p.name)+'">'+esc(p.name)+'</option>').join('')+'</select>':'<input class="bluff-input" id="answerText" maxlength="180" required autocomplete="off">')+'<button class="bluff-primary" type="submit">Antwort verdeckt abgeben</button></form>';}
   }else if(s.phase==='reveal')main+='<p class="bluff-help">Eingabe geschlossen. '+(host?'Klicke auf die Namen, um die Antworten einzeln aufzudecken.':'Die Spielleitung deckt die Antworten einzeln auf.')+'</p>';
   if(host)main+=roster(true);
  }
  const controls=host&&s.phase!=='ended'?'<footer class="bluff-controls"><div class="bluff-actions">'+phaseActions()+'</div></footer>':'';
  app.innerHTML=(host?header('','<button data-action="participation">Teilnahme</button>'+(s.phase!=='ended'?'<button class="bluff-end" data-action="end">Beenden</button>':'<a class="btn" href="../index.html">Quiz Studio</a>')):'')+'<div class="bluff-grid'+(!host?' bluff-player-grid':'')+'"><section class="panel '+(host?'bluff-host-main':'bluff-player-main')+(s.phase==='ended'?' bluff-final-result':'')+'">'+main+controls+'</section>'+(s.phase!=='ended'?'<aside class="bluff-stack '+(host?'live-sidebar':'bluff-player-standings')+'"><section class="panel ranking-panel"><h2>Rangliste</h2>'+leaderboard()+'</section></aside>':'')+'</div>';
  app.dataset.samePhase=s.phase;
  app.setAttribute('aria-busy','false');
  const next=document.getElementById('answerText');if(next&&draft!==undefined){next.value=draft;if(focused){next.focus();if(next.setSelectionRange&&next.tagName==='INPUT')next.setSelectionRange(selection,selection);}}
  const form=document.getElementById('answerForm');if(form)form.onsubmit=e=>{e.preventDefault();playerAction('same_answer',{p_answer:next.value.trim()});};
  const settings=document.getElementById('settingsForm');if(settings)settings.onsubmit=e=>{e.preventDefault();manage('configure',{p_team:Number(document.getElementById('teamCount').value),p_value:Number(document.getElementById('timerSeconds').value)});};
  revealedBefore=new Set(s.players.filter(p=>Object.hasOwn(p,'answer')).map(p=>s.round_index+':'+p.id));
  tick();
 }
 function tick(){const el=document.getElementById('sameTimer');if(el&&state?.deadline){el.textContent='Noch '+Math.max(0,Math.ceil((Date.parse(state.deadline)-Date.now())/1000))+' Sekunden';}}
 const clock=setInterval(tick,250);
 async function manage(action,args={}){if(busy||!state)return;busy=true;app.inert=true;say('');try{await rpc('same_manage',{p_session_id:room,p_round:state.round_index,p_phase:state.phase,p_action:action,p_target:null,p_team:null,p_value:null,...args});await refresh(true);}catch(e){say(errorText(e));await refresh(true);}finally{busy=false;app.inert=false;}}
 app.addEventListener('change',e=>{if(e.target.matches('[data-assign]')&&e.target.value)manage('assign',{p_target:e.target.dataset.assign,p_team:Number(e.target.value)});});
 function showParticipation(){
  const d=document.getElementById('participationDialog'),qr=d.querySelector('.bluff-qr');
  d.querySelector('.bluff-join-code').textContent=state.join_code;qr.replaceChildren();
  const u=new URL('../../../join.html',location.href);u.searchParams.set('code',state.join_code);u.searchParams.set('kind','same');
  if(typeof QRCode==='function'){new QRCode(qr,{text:u.href,width:240,height:240,correctLevel:QRCode.CorrectLevel.M});qr.removeAttribute('title');}
  d.querySelector('[data-join-link]').href=u.href;d.showModal();
  d.querySelector('[data-close]').onclick=()=>{d.close();app.querySelector('[data-action="participation"]')?.focus();};
  d.onclose=()=>app.querySelector('[data-action="participation"]')?.focus();
 }
 async function refresh(force=false){if(refreshing||!room)return;refreshing=true;try{const next=await rpc(mode==='host'?'same_host_state':'same_player_state',mode==='host'?{p_session_id:room}:{p_session_id:room,p_player_id:credentials.player,p_token:credentials.token});const signature=[next.revision,next.phase,next.round_index,next.reveal_count].join(':');state=next;if(force||signature!==lastSignature){lastSignature=signature;renderGame();}setConnectionStatus('ready','Verbunden');}catch(e){setConnectionStatus('error','Synchronisation mit Supabase fehlgeschlagen: '+errorText(e)+'. Automatischer erneuter Versuch.');if(!state){app.setAttribute('aria-busy','false');app.innerHTML=header('')+'<section class="panel"><p>Die Ansicht konnte nicht geladen werden.</p><button onclick="location.reload()">Erneut versuchen</button></section>';}}finally{refreshing=false;}}
 function connect(){if(channel)client.removeChannel(channel);channel=client.channel('same-signal-'+room).on('postgres_changes',{event:'UPDATE',schema:'public',table:'same_live_signals',filter:'session_id=eq.'+room},()=>refresh()).subscribe(status=>{if(status==='SUBSCRIBED')refresh();});if(poll)clearInterval(poll);poll=setInterval(()=>refresh(),2000);}
 async function hostAction(action){if(busy||!state)return;busy=true;say('');const snapshot=state;try{await rpc('same_host_action',{p_session_id:room,p_round:snapshot.round_index,p_phase:snapshot.phase,p_action:action});await refresh(true);}catch(e){say(errorText(e));await refresh(true);}finally{busy=false;}}
 async function playerAction(name,args){if(busy||!state)return;busy=true;say('');const buttons=[...app.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await rpc(name,{p_session_id:room,p_player_id:credentials.player,p_token:credentials.token,p_round:state.round_index,...args});await refresh(true);}catch(e){say(errorText(e));await refresh(true);}finally{busy=false;if(state)renderGame();}}
 app.addEventListener('click',async e=>{const button=e.target.closest('[data-action]');if(!button)return;const a=button.dataset.action;
 if(mode==='library'){
 const q=questions.find(q=>String(q.id)===button.dataset.id);
 if(a==='new-question')openEditor(null);if(a==='edit-question')openEditor(q);if(a==='cancel-edit')document.getElementById('questionEditor').hidden=true;
 if(a==='delete-question'&&!busy&&confirm('Frage wirklich aus deiner Sammlung löschen?')){busy=true;try{await rpc('same_question_delete',{p_id:q.id});await loadLibrary();say('Frage gelöscht.',true);}catch(err){say(errorText(err));}finally{busy=false;}}
 }else if(mode==='host'){
 if(a==='participation'){showParticipation();return;}
 if(a==='reveal'){await manage('reveal',{p_target:button.dataset.id});return;}
 if(a==='override'){await manage('override',{p_team:Number(button.dataset.team),p_value:Number(button.dataset.value)});return;}
 if(a==='end'&&!confirm('Spiel für alle beenden? Bereits vergebene Punkte bleiben erhalten.'))return;await hostAction(a);
 }
 });
 window.addEventListener('online',()=>{setConnectionStatus('waiting','Verbindung mit Supabase wird erneut geprüft …');if(mode==='library')loadLibrary().catch(e=>setConnectionStatus('error',errorText(e)));else refresh(true);});window.addEventListener('pagehide',()=>{if(channel)client.removeChannel(channel);clearInterval(poll);clearInterval(clock);});
 (async()=>{try{if(mode==='library'){if(await requireTeacher())await loadLibrary();}else if(mode==='host'){if(!await requireTeacher())return;if(!room)throw Error('Wähle zuerst Fragen aus und erstelle eine Lobby.');await refresh(true);connect();}else{const old=getStored();if(old&&/^[a-f0-9]{64}$/.test(old.token||'')&&(!params.get('code')||old.code===params.get('code').toUpperCase())){credentials=old;room=old.session;await refresh(true);if(state){connect();return;}}credentials=null;room='';lastSignature='';renderJoin();}}catch(e){say(errorText(e));setConnectionStatus('error','Verbindung fehlgeschlagen. Bitte erneut versuchen.');app.setAttribute('aria-busy','false');app.innerHTML=header('Gerade nicht erreichbar')+'<section class="panel"><p>Die Ansicht konnte nicht geladen werden. Deine gespeicherten Inhalte bleiben erhalten.</p><button onclick="location.reload()">Erneut versuchen</button></section>';}})();
})();


