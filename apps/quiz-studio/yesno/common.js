(function(){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const messages={NOT_AUTHENTICATED:'Bitte melde dich erneut mit deinem Lehrkraftkonto an.',NOT_OWNER:'Dieses Spiel ist für dein Konto nicht verfügbar.',INVALID_NAME:'Gib einen Namen mit 1 bis 120 Zeichen ein.',INVALID_QUESTION:'Gib eine Frage und ein Fragenpaket ein.',INVALID_SELECTION:'Wähle 1 bis 50 unterschiedliche Fragen aus.',INVALID_SETTINGS:'Prüfe Runden (1–50), Zeit (5–300 Sekunden) und Punkte (0–100). Ein Volltreffer muss mindestens so viele Punkte wie ein Beinahetreffer geben.',NOT_ENOUGH_QUESTIONS:'In den gewählten Paketen sind nicht genügend Fragen für diese Rundenanzahl.',NEED_TWO_PLAYERS:'Mindestens zwei Personen müssen beitreten.',NOT_ALL_READY:'Noch nicht alle Personen sind bereit.',WAITING_FOR_ANSWERS:'Warte auf alle Abgaben oder das Ende der Zeit.',INVALID_PARTICIPANT_TOKEN:'Deine Teilnahme konnte nicht bestätigt werden. Tritt bitte erneut bei.',PHASE_CHANGED:'Die Runde hat inzwischen gewechselt. Prüfe den aktuellen Spielstand.',INVALID_ANSWER:'Wähle Ja oder Nein und eine ganze Zahl zwischen 0 und der Gruppengröße.',ALREADY_SUBMITTED:'Deine Antwort ist bereits verbindlich gespeichert.',TIME_EXPIRED:'Die Zeit ist abgelaufen.',NAME_TAKEN:'Dieser Name ist bereits vergeben. Wähle einen anderen Namen.',SESSION_NOT_FOUND:'Kein Raum gefunden. Prüfe deinen Code.',GAME_ALREADY_STARTED:'Das Spiel läuft bereits. Neue Personen können nur in der Lobby beitreten.',JOIN_RATE_LIMITED:'Zu viele Versuche. Warte bitte eine Minute.',INVALID_JOIN_INPUT:'Gib einen fünfstelligen Raum-Code und einen Namen (höchstens 40 Zeichen) ein.',ROOM_FULL:'Dieser Raum ist voll (maximal 100 Personen).'};
 function error(e){return messages[e.code||e.message]||e.message||'Verbindung fehlgeschlagen. Bitte erneut versuchen.';}
 async function rpc(client,name,args={}){
  const {data,error:failure}=await client.rpc(name,args);
  if(failure)throw Error(failure.message||'Verbindung fehlgeschlagen.');
  if(data?.ok===false)throw Object.assign(Error(data.error),{code:data.error});
  return data;
 }
 function dialog(title,content){
  const opener=document.activeElement,d=document.createElement('dialog');d.className='yn-dialog';d.setAttribute('aria-label',title);
  d.innerHTML='<div class="yn-heading"><h2>'+esc(title)+'</h2><button type="button" data-close aria-label="Fenster schließen">×</button></div>'+content;
  document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();if(opener?.isConnected)opener.focus();},{once:true});d.showModal();return d;
 }
 function settings(max,random=true){return '<div class="yn-setup-row"><label for="ynSeconds">Sekunden pro Frage</label><input id="ynSeconds" name="seconds" type="number" min="5" max="300" value="60" required></div><div class="yn-setup-scoring"><div class="yn-setup-row yn-setup-points"><strong>Punkte</strong><label for="ynExact">Treffer</label><input id="ynExact" name="exact" type="number" min="0" max="100" value="3" required><label for="ynNear">Abweichung</label><input id="ynNear" name="near" type="number" min="0" max="100" value="1" required></div><div class="yn-setup-row yn-setup-tolerance"><label for="ynTolerance">Abweichung erlaubt</label><input id="ynTolerance" name="tolerance" type="number" min="0" max="100" value="1" required></div></div>'+(random?'<div class="yn-setup-row"><label for="ynRounds">Runden</label><input id="ynRounds" name="rounds" type="number" min="1" max="50" value="'+Math.min(10,Math.max(1,max))+'" required></div>':'');}
 window.YesNo={esc,error,rpc,dialog,settings};
})();
