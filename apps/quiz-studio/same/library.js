/* Named Bluff libraries use authenticated RPCs; game answers never enter participant views. */
(function(){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const errors={INVALID_NAME:'Bitte gib einen Namen mit höchstens 120 Zeichen ein.',INVALID_SELECTION:'Wähle 1 bis 50 unterschiedliche Fragen aus.',INVALID_ROUND_COUNT:'Wähle zwischen 1 und 50 Runden.',NOT_ENOUGH_QUESTIONS:'Dafür sind nicht genügend unterschiedliche Fragen in deiner Sammlung.',NOT_OWNER:'Dieses Quiz ist nicht mehr verfügbar.',NOT_AUTHENTICATED:'Bitte melde dich erneut an.'};
 let dialog=null;
 async function rpc(client,name,args={}){
  let result;
  try{result=await client.rpc(name,args);if(result.error)throw Error(result.error.message);}
  catch(e){window.setQuizSyncStatus?.('same','error','Spiel „Dieselbe Antwort“: '+(e.message||'Verbindung fehlgeschlagen.'));throw e;}
  const {data}=result;
  if(data?.ok===false){const message=errors[data.error]||data.error;if(data.error==='NOT_AUTHENTICATED')window.setQuizSyncStatus?.('same','error','Spiel „Dieselbe Antwort“: '+message);throw Error(message);}
  window.setQuizSyncStatus?.('same','ready');return data;
 }
 function openDialog(title,content){
  if(dialog){dialog.close();dialog.remove();}
  const opener=document.activeElement,d=document.createElement('dialog');dialog=d;d.className='bluff-dialog';d.setAttribute('aria-labelledby','sameDialogTitle');
  d.innerHTML='<div class="library-heading"><h2 id="sameDialogTitle">'+esc(title)+'</h2><button type="button" data-close aria-label="Fenster schließen">×</button></div>'+content;
  document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;if(opener?.isConnected)opener.focus();},{once:true});d.showModal();return d;
 }
 async function mount(root,client){
  if(!root)return;
  if(dialog){dialog.close();dialog=null;}
  let quizzes=[],busy=false;
  const list=root.querySelector('[data-same-list]'),status=root.querySelector('[data-same-status]');
  function report(e){status.textContent=e.message||'Verbindung fehlgeschlagen. Bitte erneut versuchen.';}
  function draw(){list.innerHTML=quizzes.length?'<div class="grid">'+quizzes.map(q=>'<div class="panel qzcard" data-same-quiz-id="'+esc(q.id)+'"><div class="quiz-info"><h3>'+esc(q.name)+'</h3><div class="muted">'+q.questions.length+' '+(q.questions.length===1?'Frage':'Fragen')+'</div></div><div class="card-actions"><button data-same-action="start" data-id="'+esc(q.id)+'">Start</button><button class="icon-btn" data-same-action="edit" data-id="'+esc(q.id)+'" title="Bearbeiten" aria-label="Spiel „Dieselbe Antwort“ bearbeiten"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z"/></svg></button><button class="icon-btn danger" data-same-action="delete" data-id="'+esc(q.id)+'" aria-label="'+esc(q.name)+' löschen" title="Löschen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div></div>').join('')+'</div>':'<div class="empty">Noch keine Spiele vorhanden.</div>';}
  async function reload(){
   window.setQuizSyncStatus?.('same','waiting','Lade Spiele …');const data=await rpc(client,'same_quiz_list');if(!root.isConnected)return;quizzes=data?.quizzes||[];draw();}
  async function start(name,args){const s=await rpc(client,name,args);location.href='same/live.html?session='+encodeURIComponent(s.session_id);}
  async function configure(quiz,random=false){
   const data=await rpc(client,'same_question_list'),questions=[...(data?.questions||[])];
   // Saved games keep their question copies even after removal from the bank.
   for(const q of quiz?.questions||[])if(!questions.some(x=>x.id===q.id))questions.push(q);
   const selected=new Set((quiz?.questions||[]).map(q=>q.id));
   const d=openDialog(random?'Zufälliges Spiel':quiz?'Spiel „Dieselbe Antwort“ bearbeiten':'Neues Spiel „Dieselbe Antwort“',
    '<form id="sameQuizForm">'+(random?'<label for="sameRoundCount">Anzahl der Runden</label><input id="sameRoundCount" name="rounds" type="number" min="1" max="50" value="'+Math.min(10,Math.max(1,questions.length))+'" required>':'<label for="sameQuizName">Name</label><input id="sameQuizName" maxlength="120" value="'+esc(quiz?.name||'')+'" required><fieldset><legend>Fragen auswählen</legend><div class="bluff-question-picker">'+questions.map(q=>'<label class="bluff-question-choice"><input type="checkbox" value="'+q.id+'" '+(selected.has(q.id)?'checked':'')+'><span>'+esc(q.question)+'</span></label>').join('')+'</div></fieldset><p class="muted" id="sameSelectionCount"></p>')+'<p class="bluff-dialog-status" role="status"></p><div class="studio-actions"><button type="button" data-cancel>Abbrechen</button><button class="studio-primary" type="submit">'+(random?'Lobby erstellen':quiz?'Speichern':'Quiz erstellen')+'</button></div></form>');
   const form=d.querySelector('form'),submit=form.querySelector('[type="submit"]'),error=d.querySelector('[role="status"]');let saving=false;
   d.querySelector('[data-cancel]').onclick=()=>d.close();
   function count(){d.querySelector('#sameSelectionCount').textContent=selected.size+' Fragen ausgewählt';}
   if(!random){count();form.onchange=e=>{if(e.target.type==='checkbox'){const id=Number(e.target.value);e.target.checked?selected.add(id):selected.delete(id);count();}};}
   form.onsubmit=async e=>{e.preventDefault();if(saving)return;error.textContent='';saving=true;submit.disabled=true;try{
    if(random){await start('same_create',{p_round_count:Number(d.querySelector('#sameRoundCount').value),p_question_ids:null});}
    else{if(selected.size<1||selected.size>50)throw Error(errors.INVALID_SELECTION);await rpc(client,'same_quiz_save',{p_id:quiz?.id||null,p_name:d.querySelector('#sameQuizName').value.trim(),p_question_ids:[...selected]});d.close();await reload();}
   }catch(err){error.textContent=err.message;}finally{saving=false;submit.disabled=false;}};
  }
  root.onclick=async e=>{const b=e.target.closest('[data-same-action]');if(!b||busy)return;const a=b.dataset.sameAction,q=quizzes.find(q=>q.id===b.dataset.id);busy=true;b.disabled=true;status.textContent='';try{
   if(a==='new'||a==='edit'||a==='random')await configure(q,a==='random');
   if(a==='start')await start('same_quiz_start',{p_id:q.id});
   if(a==='delete'&&confirm('Spiel „Dieselbe Antwort“ „'+q.name+'“ löschen?')){await rpc(client,'same_quiz_delete',{p_id:q.id});await reload();}
  }catch(err){report(err);}finally{busy=false;b.disabled=false;}};
  try{await reload();}catch(e){list.innerHTML='<button data-same-action="retry">Erneut laden</button>';report(e);root.querySelector('[data-same-action="retry"]').onclick=async()=>{try{status.textContent='';await reload();}catch(err){report(err);}};}
 }
 window.SameLibrary={mount};
})();

