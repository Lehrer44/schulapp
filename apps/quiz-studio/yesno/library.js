(function(){
 'use strict';
 const {esc,error,rpc,dialog,settings}=window.YesNo;
 async function mount(root,client){
  if(!root)return;
  let games=[],sessions=[],busy=false;
  const list=root.querySelector('[data-yn-list]'),status=root.querySelector('[data-yn-status]');
  const call=async(name,args)=>{
   try{const data=await rpc(client,name,args);window.setQuizSyncStatus?.('yesno','ready');return data;}
   catch(e){if(!e.code||e.code==='NOT_AUTHENTICATED')window.setQuizSyncStatus?.('yesno','error','Ja oder Nein: '+error(e));throw e;}
  };
  async function reload(){
   window.setQuizSyncStatus?.('yesno','waiting','Lade Ja/Nein-Spiele …');
   const data=await call('yesno_game_list');if(!root.isConnected)return;
   games=data.games||[];sessions=data.sessions||[];
   list.innerHTML=(sessions.length?'<div class="yn-resume"><h3>Offene Spiele</h3>'+sessions.map(s=>'<a class="btn" href="yesno/live.html?session='+esc(s.id)+'">'+esc(s.title)+' · '+esc(s.join_code)+' · Fortsetzen</a>').join('')+'</div>':'')+(games.length?'<div class="grid">'+games.map(g=>'<div class="panel qzcard" data-yn-game-id="'+esc(g.id)+'"><div class="quiz-info"><h3>'+esc(g.name)+'</h3><div class="muted">'+g.questions.length+' Fragen</div></div><div class="card-actions"><button data-yn-action="start" data-id="'+esc(g.id)+'">Start</button><button class="icon-btn" data-yn-action="edit" data-id="'+esc(g.id)+'" title="Bearbeiten" aria-label="Ja/Nein-Spiel bearbeiten"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z"/></svg></button><button class="icon-btn danger" data-yn-action="delete" data-id="'+esc(g.id)+'" aria-label="'+esc(g.name)+' löschen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div></div>').join('')+'</div>':'<div class="empty">Noch keine Spiele vorhanden.</div>');
  }
  async function configure(game,start){
   const data=await call('yesno_question_list'),questions=[...(data.questions||[])];
   for(const q of game?.questions||[])if(!questions.some(x=>x.id===q.id))questions.push(q);
   const pool=start&&game?game.questions:questions,selected=new Set((game?.questions||[]).map(q=>q.id));
   const packs=[...new Set(pool.map(q=>q.pack))].sort((a,b)=>a.localeCompare(b,'de'));
   const requestId=crypto.randomUUID();
   const d=dialog(start?'Spiel einstellen':game?'Ja/Nein-Spiel bearbeiten':'Neues Ja/Nein-Spiel',
    '<form id="ynGameForm">'+(start?settings(pool.length)+'<fieldset><legend>Fragenpakete</legend><div class="yn-packs">'+packs.map(p=>'<label><input name="pack" type="checkbox" value="'+esc(p)+'" checked> '+esc(p)+'</label>').join('')+'</div></fieldset><p data-available class="muted"></p>':'<label>Spielname<input name="gameName" maxlength="120" value="'+esc(game?.name||'')+'" required></label><fieldset><legend>Ganze Fragenpakete auswählen</legend><div class="yn-packs">'+packs.map(p=>'<label><input name="selectPack" type="checkbox" value="'+esc(p)+'"> '+esc(p)+'</label>').join('')+'</div></fieldset><fieldset><legend>Fragen auswählen (1–50)</legend><div class="yn-picker">'+questions.map(q=>'<label><input type="checkbox" name="question" value="'+q.id+'" '+(selected.has(q.id)?'checked':'')+'><span>'+esc(q.question)+'<small>'+esc(q.pack)+'</small></span></label>').join('')+'</div></fieldset><p data-selected class="muted"></p>')+
    '<p role="status" class="yn-error"></p><div class="studio-actions"><button type="button" data-cancel>Abbrechen</button><button class="studio-primary" type="submit">'+(start?'Lobby erstellen':'Speichern')+'</button></div></form>');
   const form=d.querySelector('form'),submit=form.querySelector('[type="submit"]'),notice=form.querySelector('[role="status"]');let saving=false;
   d.querySelector('[data-cancel]').onclick=()=>d.close();
   function update(){
    if(start){const chosen=[...form.querySelectorAll('[name="pack"]:checked')].map(x=>x.value);form.querySelector('[data-available]').textContent=pool.filter(q=>chosen.includes(q.pack)).length+' Fragen verfügbar · keine Wiederholungen';}
    else {form.querySelector('[data-selected]').textContent=selected.size+' Fragen ausgewählt';form.querySelectorAll('[name="question"]').forEach(c=>c.checked=selected.has(Number(c.value)));form.querySelectorAll('[name="selectPack"]').forEach(c=>{const ids=questions.filter(q=>q.pack===c.value).map(q=>q.id),count=ids.filter(id=>selected.has(id)).length;c.checked=count===ids.length;c.indeterminate=count>0&&count<ids.length;});}
   }
   form.onchange=e=>{if(e.target.name==='selectPack'){questions.filter(q=>q.pack===e.target.value).forEach(q=>e.target.checked?selected.add(q.id):selected.delete(q.id));}if(e.target.name==='question'){const id=Number(e.target.value);e.target.checked?selected.add(id):selected.delete(id);}update();};update();
   form.onsubmit=async e=>{
    e.preventDefault();if(saving)return;saving=true;submit.disabled=true;notice.textContent='';
    try{
     if(start){
      const value=Object.fromEntries(new FormData(form)),packs=[...form.querySelectorAll('[name="pack"]:checked')].map(x=>x.value);
      if(!packs.length)throw Error('Wähle mindestens ein Fragenpaket.');
      const s=await call('yesno_create_configured',{p_request_id:requestId,p_game_id:game?.id||null,p_rounds:Number(value.rounds),p_seconds:Number(value.seconds),p_exact:Number(value.exact),p_near:Number(value.near),p_tolerance:Number(value.tolerance),p_reveal_answers:value.visibility==='open',p_packs:packs});
      location.href='yesno/live.html?session='+encodeURIComponent(s.session_id);
     }else{
      if(selected.size<1||selected.size>50)throw Error('Wähle 1 bis 50 Fragen aus.');
      await call('yesno_game_save',{p_id:game?.id||null,p_name:form.elements.gameName.value.trim(),p_question_ids:[...selected]});d.close();await reload();
     }
    }catch(e){notice.textContent=error(e);}finally{saving=false;submit.disabled=false;}
   };
  }
  root.onclick=async e=>{
   const b=e.target.closest('[data-yn-action]');if(!b||busy)return;
   busy=true;b.disabled=true;status.textContent='';
   try{
    const action=b.dataset.ynAction,game=games.find(g=>g.id===b.dataset.id);
    if(action==='random'||action==='start')await configure(game,true);
    else if(action==='new'||action==='edit')await configure(game,false);
    else if(action==='delete'&&confirm('Ja/Nein-Spiel „'+game.name+'“ löschen?')){await call('yesno_game_delete',{p_id:game.id});await reload();}
    else if(action==='retry')await reload();
   }catch(e){status.textContent=error(e);}finally{busy=false;b.disabled=false;}
  };
  try{await reload();}catch(e){list.innerHTML='<button data-yn-action="retry">Erneut laden</button>';status.textContent=error(e);}
 }
 window.YesNoLibrary={mount};
})();

