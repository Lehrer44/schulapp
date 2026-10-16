(function(root){
 'use strict';let status={mode:'waiting',text:'Verbindung wird geprüft …'};
 function draw(){
  if(!document.body)return;
  let el=document.getElementById('connectionStatus');
  if(!el){el=document.createElement('div');el.id='connectionStatus';el.className='connection-status';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.prepend(el);}
  el.dataset.state=status.mode;
  if(el.textContent!==status.text)el.textContent=status.text;
 }
 root.setConnectionStatus=function(mode,text){status={mode,text};draw();};
 root.addEventListener('offline',()=>root.setConnectionStatus('error','Offline. Eingaben bleiben auf dieser Seite erhalten. Neue Antworten und Änderungen sind noch nicht gespeichert.'));
 root.addEventListener('online',()=>root.setConnectionStatus('waiting','Verbindung wieder verfügbar. Der aktuelle Stand wird geprüft …'));
 document.addEventListener('DOMContentLoaded',draw);
})(window);
