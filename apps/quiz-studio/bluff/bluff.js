/* Supabase is authoritative for secrets, phases, deadlines and scoring. */
(function(){
 'use strict';
 const client=supabase.createClient('https://mqtcwiiawmuxrpkjfrfc.supabase.co','sb_publishable_eY5NBW8EJHuyO2Ic5S3HBQ_tSwErhp-');
 const app=document.getElementById('app'),message=document.getElementById('appMessage'),mode=document.body.dataset.bluffMode,params=new URLSearchParams(location.search);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Store real uppercase text, including pasted text; keep the caret stable when ß expands.
 function upperAnswer(value){return String(value??'').normalize('NFC').replace(/[ßẞ]/g,'SS').toUpperCase();}
 function bindUpperAnswer(input,onChange=()=>{}){
  const convert=e=>{if(e?.isComposing)return;const value=input.value,start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
   const upper=upperAnswer(value);if(value!==upper){input.value=upper;if(start!==null)input.setSelectionRange(upperAnswer(value.slice(0,start)).length,upperAnswer(value.slice(0,end)).length,direction);}
   input.setCustomValidity(Array.from(upper).length>180?'Die Antwort darf höchstens 180 Zeichen enthalten.':'');onChange(upper);
  };
  input.addEventListener('input',convert);input.addEventListener('compositionend',convert);convert();
 }
 const labels={lobby:'Wartelobby',question:'Die Frage',bluff:'Antworten eingeben',answers:'Anonyme Antworten',vote:'Wahrheit finden',reveal:'Enthüllung',leaderboard:'Rundenwertung',ended:'Spiel beendet'};
 const errors={NOT_AUTHENTICATED:'Bitte melde dich mit deinem Lehrerkonto an.',NOT_OWNER:'Dieser Bereich gehört zu einem anderen Lehrerkonto.',INVALID_QUESTION:'Bitte prüfe Frage und Lösung.',INVALID_ROUND_COUNT:'Wähle zwischen 1 und 50 Runden.',INVALID_SELECTION:'Wähle genau so viele unterschiedliche Fragen wie Runden.',NOT_ENOUGH_QUESTIONS:'Die Sammlung enthält dafür noch nicht genügend Fragen. Ergänze Fragen oder verringere die Rundenzahl.',NAME_TAKEN:'Dieser Name wird bereits verwendet. Wähle einen anderen Namen.',GAME_ALREADY_STARTED:'Das Spiel läuft bereits. Neue Spieler können erst beim nächsten Spiel beitreten.',ROOM_FULL:'Der Raum ist voll (maximal 50 Personen).',INVALID_JOIN_INPUT:'Prüfe Code und Namen.',SESSION_NOT_FOUND:'Dieser Raum ist nicht mehr verfügbar.',INVALID_PARTICIPANT_TOKEN:'Die Teilnahme konnte nicht bestätigt werden. Tritt bitte mit einem neuen Namen bei.',NEED_TWO_PLAYERS:'Zum Start müssen mindestens zwei Personen beigetreten sein.',WAITING_FOR_ANSWERS:'Es fehlen noch Antworten. Warte, bis alle abgegeben haben.',NO_BLUFFS:'Noch kein Bluff eingegangen. Gib mehr Zeit oder warte auf die erste Eingabe.',PHASE_CHANGED:'Die Spielphase hat sich geändert. Die Ansicht wird aktualisiert.',TIME_EXPIRED:'Die Zeit ist abgelaufen. Warte auf die nächste Phase.',INVALID_ANSWER:'Schreibe einen Bluff mit 1 bis 180 Zeichen.',ANSWER_MATCHES_TRUTH:'Das ist bereits die richtige Antwort. Erfinde einen anderen Bluff.',OWN_VOTE_FORBIDDEN:'Du kannst nicht für deinen eigenen Bluff stimmen.',VOTE_ALREADY_CAST:'Deine Stimme ist bereits verbindlich gespeichert.',INVALID_OPTION:'Diese Antwort gehört nicht zur aktuellen Runde.',JOIN_RATE_LIMITED:'Zu viele Beitrittsversuche. Warte bitte eine Minute.',INVALID_ACTION:'Diese Aktion ist in der aktuellen Phase nicht möglich.'};
 let state=null,room=params.get('session')||'',credentials=null,questions=[],busy=false,refreshing=false,channel=null,poll=null,lastSignature='',draft='',draftRound=-1,lastExpired='',offset=0,editing=null,timerChoice=60,seenReveals=new Set();
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
 function header(sub,actions=''){if(mode==='player')return '';return '<header class="studio-header"><div class="studio-identity"><span class="studio-icon" aria-hidden="true">⧉</span><div><h1 class="studio-title">Manipulation</h1>'+(sub?'<p class="bluff-subtitle">'+esc(sub)+'</p>':'')+'</div></div><div class="studio-actions">'+actions+'</div></header>';}
 function rules(){return '<ol class="bluff-rules"><li>Erfinde eine glaubwürdige Antwort.</li><li>Finde die echte Antwort: <b>+1 Punkt</b>.</li><li>Jede Stimme für deine Antwort: <b>+2 Punkte</b>.</li><li>Du kannst deine eigene Antwort nicht wählen.</li></ol>';}
 async function requireTeacher(){const {data,error}=await client.auth.getUser();if(error||!data?.user){location.href='../../../login.html?next=apps%2Fquiz-studio%2Fbluff%2Findex.html';return false;}return true;}
 async function loadLibrary(){const q=await rpc('bluff_question_list');questions=q.questions;renderLibrary();setConnectionStatus('ready','Fragensammlung mit Supabase verbunden.');}
 function questionRows(){return questions.map(q=>'<article class="collection-row" data-question-id="'+q.id+'"><div><h3>'+esc(q.question)+'</h3><p><strong>Lösung:</strong> '+esc(upperAnswer(q.correct_answer))+'</p></div><div class="bluff-row"><button data-action="edit-question" data-id="'+q.id+'">Bearbeiten</button><button class="danger" data-action="delete-question" data-id="'+q.id+'">Löschen</button></div></article>').join('');}
 function renderLibrary(){
  app.setAttribute('aria-busy','false');
  app.innerHTML=header('Fragensammlung','<button class="studio-primary" data-action="new-question">＋ Frage hinzufügen</button>')+
  '<section class="panel"><div class="library-heading"><h2>Deine Fragensammlung</h2><span class="library-count">'+questions.length+' Fragen</span></div><section class="bluff-editor" id="questionEditor" hidden><h3 id="editorTitle">Neue Frage</h3><form id="questionForm"><label class="bluff-label" for="questionText">Frage</label><textarea id="questionText" class="bluff-textarea" minlength="5" maxlength="500" required></textarea><label class="bluff-label" for="correctAnswer">Lösung</label><input id="correctAnswer" autocapitalize="characters" autocorrect="off" spellcheck="false" class="bluff-input" maxlength="180" required><div class="bluff-actions"><button class="studio-primary" type="submit">Frage speichern</button><button type="button" data-action="cancel-edit">Abbrechen</button></div><p id="questionSaveState" role="status"></p></form></section><div id="questionRows">'+questionRows()+'</div></section>';
  document.getElementById('questionForm').onsubmit=saveQuestion;bindUpperAnswer(document.getElementById('correctAnswer'));
 }
 function openEditor(q){editing=q?.id??null;const editor=document.getElementById('questionEditor');editor.hidden=false;document.getElementById('editorTitle').textContent=q?'Frage bearbeiten':'Neue Frage';for(const [id,key] of [['questionText','question'],['correctAnswer','correct_answer']])document.getElementById(id).value=q?.[key]||'';document.getElementById('correctAnswer').value=upperAnswer(q?.correct_answer||'');document.getElementById('correctAnswer').dispatchEvent(new Event('input'));editor.scrollIntoView({block:'start',behavior:'smooth'});document.getElementById('questionText').focus({preventScroll:true});}
 async function saveQuestion(e){e.preventDefault();if(busy)return;busy=true;const button=e.submitter;button.disabled=true;say('');try{const q=questions.find(q=>q.id===editing);await rpc('bluff_question_save',{p_id:editing,p_question:document.getElementById('questionText').value.trim(),p_correct_answer:upperAnswer(document.getElementById('correctAnswer').value.trim()),p_category:q?.category||'',p_source_url:q?.source_url||''});await loadLibrary();say('Frage gespeichert.',true);}catch(e){document.getElementById('questionSaveState').textContent=errorText(e);}finally{busy=false;button.disabled=false;}}
 function getStored(){try{return JSON.parse(sessionStorage.getItem('bluff.credentials.v1')||'null');}catch{return null;}}
 function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function renderJoin(){app.setAttribute('aria-busy','false');app.innerHTML=header('Mitspielen · Bluffe klug, rate besser')+'<div class="bluff-grid"><section class="panel"><h2>Manipulation beitreten</h2><form id="joinForm"><label class="bluff-label" for="roomCode">Raum-Code</label><input class="bluff-input bluff-code" id="roomCode" maxlength="5" minlength="5" pattern="[A-Za-z0-9]{5}" required autocapitalize="characters" autocomplete="off" value="'+esc((params.get('code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5))+'"><label class="bluff-label" for="playerName">Dein Name</label><input class="bluff-input" id="playerName" maxlength="40" required autocomplete="off"><button class="bluff-primary" type="submit" style="margin-top:18px">Beitreten →</button></form></section><aside class="panel"><h2>So funktioniert es</h2>'+rules()+'</aside></div>';
 document.getElementById('roomCode').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
 document.getElementById('joinForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;e.submitter.disabled=true;try{const t=credentials?.token||token();const d=await rpc('bluff_join',{p_code:document.getElementById('roomCode').value,p_name:document.getElementById('playerName').value.trim(),p_token:t});credentials={session:d.session_id,player:d.player_id,token:t,name:d.name,code:d.join_code};try{sessionStorage.setItem('bluff.credentials.v1',JSON.stringify(credentials));}catch{}room=d.session_id;lastSignature='';say('');await refresh(true);connect();}catch(err){say(errorText(err));}finally{busy=false;e.submitter.disabled=false;}};
 }
 function leaderboard(){if(!state.players.length)return '<div class="bluff-empty">noch keine Teilnehmer</div>';return '<div class="bluff-stack">'+state.players.map((p,i)=>{
  const submitted=mode==='host'&&['bluff','answers'].includes(state.phase)&&p.submitted;
  const voted=mode==='host'&&state.phase==='vote'&&p.voted;
  const status=submitted?'Antwort eingegeben':voted?'Stimme abgegeben':'';
  return '<div class="bluff-score '+(p.id===credentials?.player?'me ':'')+(submitted?'has-answer':voted?'has-vote':'')+'" data-player-id="'+esc(p.id)+'"><span>'+(state.phase==='ended'?1+state.players.filter(other=>Number(other.score)>Number(p.score)).length:i+1)+'</span><strong class="bluff-score-name">'+esc(p.name)+(status?'<span class="bluff-answer-mark" role="img" aria-label="'+status+'" title="'+status+'">✓</span>':'')+'</strong><b>'+p.score+' P</b></div>';
 }).join('')+'</div>';}
 function phaseActions(){const s=state;if(s.phase==='lobby')return '<button class="bluff-primary" data-action="start" '+(s.players.length<2?'disabled':'')+'>Spiel starten</button>';if(s.phase==='question')return '<button class="bluff-primary" data-action="open_bluff">Bluff-Phase öffnen</button>';if(s.phase==='bluff')return '<button class="bluff-primary" data-action="show_answers" '+(s.players.some(p=>!p.submitted)?'disabled':'')+'>Antworten anzeigen</button>';if(s.phase==='answers')return '<button class="bluff-primary" data-action="start_vote">Abstimmung starten</button>';if(s.phase==='vote')return '<button class="bluff-primary" data-action="reveal">Abstimmung schließen & enthüllen</button>';if(s.phase==='reveal')return '<button class="bluff-primary" data-action="reveal_next">Alle Antworten aufdecken</button>';if(s.phase==='leaderboard')return '<button class="bluff-primary" data-action="next">'+(s.round_index+1>=s.round_count?'Endergebnis anzeigen':'Nächste Runde →')+'</button>';return '';}
 function personChip(person,kind){
  return '<span class="'+kind+'"><span class="bluff-person-name">'+esc(person.name||'Teilnehmende Person')+'</span></span>';
 }
 function optionCards(host){
  const s=state,voting=s.phase==='vote'&&!host;
  return '<div class="bluff-options"'+(voting?' role="radiogroup" aria-label="Antwort auswählen"':'')+'>'+s.options.map(o=>{
   const choosing=voting&&!o.revealed;
   const content=o.revealed?'<div class="bluff-authors">'+(o.is_truth?'✓ Die echte Antwort':o.authors.map(p=>personChip(p,'bluff-author')).join(''))+'</div>':'';
   const choice=choosing&&!o.own?'<label class="bluff-vote-control"><input type="radio" name="bluff-vote" data-action="vote" data-id="'+esc(o.id)+'" aria-label="Antwort wählen: '+esc(upperAnswer(o.answer))+'" '+(s.own_vote===o.id?'checked ':'')+(s.own_vote||expired()?'disabled':'')+'></label>':'';
   const voters=o.revealed?'<div class="bluff-voters"><div class="bluff-voter-list" aria-label="Stimmen">'+o.voters.map(p=>personChip(p,'bluff-voter')).join('')+'</div></div>':'';
   return '<article class="bluff-option manipulation-option '+(choosing?'bluff-voting-option ':'')+(o.revealed?'revealed ':'')+(o.revealed&&!seenReveals.has(o.id)?'new-reveal ':'')+(o.is_truth?'truth':'')+'" data-option-id="'+esc(o.id)+'"><div class="bluff-option-answer"><h3>'+esc(upperAnswer(o.answer))+'</h3>'+content+'</div>'+choice+voters+'</article>';
  }).join('')+'</div>';
 }
 function expired(){return !!state?.deadline&&Date.parse(state.deadline)<=Date.now()+offset;}
 function renderGame(){const s=state,host=mode==='host',focused=document.activeElement?.id,selection=document.activeElement?.selectionStart;
 if(draftRound!==s.round_index){draft=upperAnswer(s.own_entry?.answer||'');draftRound=s.round_index;}
 let main='';
 if(s.phase!=='lobby'){
 main=s.phase==='ended'?'<h2 class="bluff-question">'+(host?'Endplatzierung':'Platzierung')+'</h2><div class="bluff-final-ranking">'+leaderboard()+'</div>':'<div class="bluff-row bluff-between"><span class="bluff-help">Runde '+(s.round_index+1)+' von '+s.round_count+'</span></div><h2 class="bluff-question">'+esc(s.question)+'</h2>';
 if(s.phase==='question')main+='<p>Lies die Frage. Die echte Antwort bleibt geheim.</p>'+(!host?'<p class="bluff-help">Die Spielleitung öffnet gleich das Textfeld.</p>':'');
 if(s.phase==='bluff'){
  if(!host)main+='<form id="bluffForm"><label class="bluff-label" for="bluffAnswer">Deine glaubwürdige Fake-Antwort</label><textarea class="bluff-textarea" id="bluffAnswer" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="180" required '+(expired()?'disabled':'')+'>'+esc(draft)+'</textarea><button class="bluff-primary" id="sendBluff" type="submit" '+(expired()?'disabled':'')+'>'+(s.own_entry?'Antwort aktualisieren':'Antwort abgeben')+'</button><p class="bluff-save-status">'+(s.own_entry?'✓ Gespeichert: '+esc(upperAnswer(s.own_entry.answer)):'Noch nicht abgegeben.')+'</p></form>';
 }
 if(['answers','vote','reveal','leaderboard'].includes(s.phase)){
  if(s.phase==='vote'&&s.own_vote&&!host)main+='<p class="bluff-save-status">✓ Deine Stimme ist gespeichert.</p>';
  if(s.phase==='reveal')main+='<p>Die Spielleitung deckt alle Antworten gleichzeitig auf.</p>';
  main+=optionCards(host);
 }
 }
 const lobbyHost=host&&s.phase==='lobby';
 const timer=host&&['bluff','vote'].includes(s.phase)?'<div class="bluff-timer"><select class="bluff-select" id="timerSeconds" aria-label="Zeitlimit">'+[[30,'30 s'],[60,'60 s'],[90,'90 s'],[120,'2 min'],[180,'3 min']].map(([v,l])=>'<option value="'+v+'" '+(timerChoice===v?'selected':'')+'>'+l+'</option>').join('')+'</select><button class="bluff-clock-button" data-action="timer" aria-label="Timer starten oder neu setzen" title="Timer starten oder neu setzen"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button></div>':'';
 const counter='<p id="countdown" class="bluff-counter" role="timer" aria-live="off"></p>';
 const controls=host&&s.phase!=='ended'?'<footer class="bluff-controls"><div class="bluff-actions">'+phaseActions()+'</div><div class="bluff-timer-area">'+counter+timer+'</div></footer>':host?'':counter;
 const mainPanel=lobbyHost?'<button type="button" class="panel bluff-start-card" data-action="start" '+(s.players.length<2?'disabled':'')+'>Spiel starten</button>':s.phase==='lobby'?'':'<section class="panel '+(host?'bluff-host-main':'bluff-player-main')+(s.phase==='ended'?' bluff-final-result':'')+'">'+main+controls+'</section>';
 const scores=s.phase!=='ended'?'<section class="panel ranking-panel"><h2>Rangliste</h2>'+leaderboard()+'</section>':'';
 const help=!host&&s.phase==='lobby'?'<section class="panel bluff-lobby-rules"><h2>Punkte sammeln</h2>'+rules()+'</section>':'';
 const standings=scores?'<aside class="bluff-stack '+(host?'live-sidebar':'bluff-player-standings')+'"'+(host?' tabindex="0"':'')+' aria-label="Rangliste">'+scores+'</aside>':'';
 app.innerHTML=(host?header('','<button data-action="participation">Teilnahme</button><button class="bluff-end" data-action="end">Beenden</button>'):'')+'<div class="bluff-grid'+(lobbyHost?' bluff-lobby':'')+(!host?' bluff-player-grid':'')+'">'+help+mainPanel+standings+'</div>';
 s.options.filter(o=>o.revealed).forEach(o=>seenReveals.add(o.id));
 const timerSelect=document.getElementById('timerSeconds');if(timerSelect)timerSelect.onchange=()=>timerChoice=Number(timerSelect.value);
 app.setAttribute('aria-busy','false');
 const form=document.getElementById('bluffForm');if(form){const input=document.getElementById('bluffAnswer');bindUpperAnswer(input,value=>draft=value);form.onsubmit=async e=>{e.preventDefault();await playerAction('bluff_submit',{p_answer:upperAnswer(input.value.trim())});};}
 countdown();if(focused){const el=document.getElementById(focused);if(el&&!el.disabled){el.focus({preventScroll:true});if(typeof selection==='number'&&el.setSelectionRange)el.setSelectionRange(selection,selection);}}
 }
 function showParticipation(){
  const d=document.getElementById('participationDialog'),qr=d.querySelector('.bluff-qr');
  d.querySelector('.bluff-join-code').textContent=state.join_code;qr.replaceChildren();
  const u=new URL('../../../join.html',location.href);u.searchParams.set('code',state.join_code);u.searchParams.set('kind','bluff');
  if(typeof QRCode==='function'){new QRCode(qr,{text:u.href,width:240,height:240,correctLevel:QRCode.CorrectLevel.M});qr.removeAttribute('title');}
  d.querySelector('[data-join-link]').href=u.href;d.showModal();
  d.querySelector('[data-close]').onclick=()=>{d.close();app.querySelector('[data-action="participation"]')?.focus();};
  d.onclose=()=>app.querySelector('[data-action="participation"]')?.focus();
 }
 async function refresh(force=false){if(refreshing||!room)return;refreshing=true;try{const next=await rpc(mode==='host'?'bluff_host_state':'bluff_player_state',mode==='host'?{p_session_id:room}:{p_session_id:room,p_player_id:credentials.player,p_token:credentials.token});offset=Date.parse(next.server_now)-Date.now();const signature=[next.revision,next.phase,next.round_index,next.reveal_count].join(':');state=next;if(force||signature!==lastSignature){lastSignature=signature;renderGame();}setConnectionStatus('ready','Verbunden');}catch(e){setConnectionStatus('error','Synchronisation mit Supabase fehlgeschlagen: '+errorText(e)+'. Automatischer erneuter Versuch.');if(!state){app.setAttribute('aria-busy','false');app.innerHTML=header('')+'<section class="panel"><p>Die Ansicht konnte nicht geladen werden.</p><button onclick="location.reload()">Erneut versuchen</button></section>';}}finally{refreshing=false;}}
 function countdown(){if(!state)return;const el=document.getElementById('countdown');if(!el)return;if(!state.deadline){el.textContent='';return;}const seconds=Math.max(0,Math.ceil((Date.parse(state.deadline)-Date.now()-offset)/1000));el.textContent=seconds?'Noch '+seconds+' s':state.phase==='bluff'?(mode==='host'?'Zeit abgelaufen · mehr Zeit geben':'Zeit abgelaufen · warte auf die Spielleitung'):'Zeit abgelaufen · warte auf den Phasenwechsel';if(!seconds){const send=document.getElementById('sendBluff');if(send)send.disabled=true;app.querySelectorAll('[data-action="vote"]').forEach(b=>b.disabled=true);if(mode==='host'&&!busy&&lastExpired!==state.revision){lastExpired=state.revision;hostAction('expire');}}}
 function connect(){if(channel)client.removeChannel(channel);channel=client.channel('bluff-signal-'+room).on('postgres_changes',{event:'UPDATE',schema:'public',table:'bluff_live_signals',filter:'session_id=eq.'+room},()=>refresh()).subscribe(status=>{if(status==='SUBSCRIBED')refresh();});if(poll)clearInterval(poll);poll=setInterval(()=>refresh(),2000);}
 async function hostAction(action){if(busy||!state)return;busy=true;say('');const snapshot=state;try{const seconds=action==='timer'?Number(document.getElementById('timerSeconds').value):null;await rpc('bluff_host_action',{p_session_id:room,p_round:snapshot.round_index,p_phase:snapshot.phase,p_action:action,p_seconds:seconds,p_reveal_count:snapshot.reveal_count});if(action==='end'){location.href='../index.html';return;}await refresh(true);}catch(e){say(errorText(e));await refresh(true);}finally{busy=false;}}
 async function playerAction(name,args){if(busy||!state)return;busy=true;say('');const buttons=[...app.querySelectorAll('button,input[data-action="vote"]')];buttons.forEach(b=>b.disabled=true);try{await rpc(name,{p_session_id:room,p_player_id:credentials.player,p_token:credentials.token,p_round:state.round_index,...args});await refresh(true);}catch(e){say(errorText(e));await refresh(true);}finally{busy=false;if(state)renderGame();}}
 app.addEventListener('click',async e=>{const button=e.target.closest('[data-action]');if(!button)return;const a=button.dataset.action;
 if(mode==='library'){
 const q=questions.find(q=>String(q.id)===button.dataset.id);
 if(a==='new-question')openEditor(null);if(a==='edit-question')openEditor(q);if(a==='cancel-edit')document.getElementById('questionEditor').hidden=true;
 if(a==='delete-question'&&!busy&&confirm('Frage wirklich aus deiner Sammlung löschen?')){busy=true;try{await rpc('bluff_question_delete',{p_id:q.id});await loadLibrary();say('Frage gelöscht.',true);}catch(err){say(errorText(err));}finally{busy=false;}}
 }else if(mode==='host'){if(a==='participation'){showParticipation();return;}if(a==='end'&&!confirm('Spiel für alle beenden? Bereits vergebene Punkte bleiben erhalten.'))return;await hostAction(a);}else if(a==='vote'){await playerAction('bluff_vote',{p_option_id:button.dataset.id});}
 });
 window.addEventListener('online',()=>{setConnectionStatus('waiting','Verbindung mit Supabase wird erneut geprüft …');if(mode==='library')loadLibrary().catch(e=>setConnectionStatus('error',errorText(e)));else refresh(true);});window.addEventListener('pagehide',()=>{if(channel)client.removeChannel(channel);clearInterval(poll);});setInterval(countdown,250);
 (async()=>{try{if(mode==='library'){if(await requireTeacher())await loadLibrary();}else if(mode==='host'){if(!await requireTeacher())return;if(!room)throw Error('Wähle zuerst Fragen aus und erstelle eine Lobby.');await refresh(true);connect();}else{const old=getStored();if(old&&/^[a-f0-9]{64}$/.test(old.token||'')&&(!params.get('code')||old.code===params.get('code').toUpperCase())){credentials=old;room=old.session;await refresh(true);if(state){connect();return;}}credentials=null;room='';renderJoin();}}catch(e){say(errorText(e));setConnectionStatus('error','Verbindung fehlgeschlagen. Bitte erneut versuchen.');app.setAttribute('aria-busy','false');app.innerHTML=header('Gerade nicht erreichbar')+'<section class="panel"><p>Die Ansicht konnte nicht geladen werden. Deine gespeicherten Inhalte bleiben erhalten.</p><button onclick="location.reload()">Erneut versuchen</button></section>';}})();
})();


