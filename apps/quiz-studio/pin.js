/* Pin coordinates use percentages; radius is a percentage of image width. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const image=q=>q?.media?.type==='image'&&/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(q.media.data||'')?q.media.data:'';
 const point=a=>!!a&&typeof a.x==='number'&&typeof a.y==='number'&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&a.x>=0&&a.x<=100&&a.y>=0&&a.y<=100;
 const target=q=>point(q?.pinTarget)&&typeof q.pinTarget.radius==='number'&&q.pinTarget.radius>=.5&&q.pinTarget.radius<=50&&Number.isFinite(q.pinAspect)&&q.pinAspect>=.01&&q.pinAspect<=100;
 const valid=q=>!!image(q)&&target(q);
 function correct(q,a){return target(q)&&point(a)&&Math.hypot(a.x-q.pinTarget.x,(a.y-q.pinTarget.y)/q.pinAspect)<=q.pinTarget.radius+1e-9;}
 function color(id){let hash=0;for(const c of String(id))hash=(hash*31+c.charCodeAt(0))>>>0;return 'hsl('+(hash%360)+',68%,38%)';}
 function markup(q,{answer=null,showTarget=false,editable=false,editor=false,markers=[]}={}){
  const src=image(q);if(!src)return '<p class="pin-hint">Bitte füge ein Bild für die Pin-Frage ein.</p>';
  const marks=markers.filter(m=>point(m.answer));
  return '<section class="quiz-pin" data-quiz-pin><div class="quiz-pin-board" '+(editable?'tabindex="0" role="application" aria-label="'+(editor?'Lösungsmittelpunkt':'Antwort-Pin')+' setzen. Pfeiltasten bewegen den Pin, Umschalt bewegt ihn schneller."':'role="img" aria-label="Karte mit Pins"')+'><img src="'+esc(src)+'" alt="'+esc(q.media.name||'Bild zur Pin-Frage')+'" draggable="false"><div class="quiz-pin-target" hidden></div><span class="quiz-pin-own" hidden aria-hidden="true"></span>'+marks.map((m,i)=>'<span class="quiz-pin-marker" style="left:'+m.answer.x+'%;top:'+m.answer.y+'%;background:'+color(m.id)+'" title="'+esc(m.name)+'">'+(i+1)+'</span>').join('')+'</div>'+(editable?'<p class="pin-hint">'+(editor?'Klicke auf die richtige Stelle und stelle den grünen Lösungsradius ein.':'Tippe auf die gesuchte Stelle oder verwende die Pfeiltasten. Bestätige anschließend mit „Antwort abgeben“.')+'</p><div class="quiz-pin-controls"><label>X (%) <input data-pin-x type="number" min="0" max="100" step="0.1" aria-label="Pin X in Prozent"></label><label>Y (%) <input data-pin-y type="number" min="0" max="100" step="0.1" aria-label="Pin Y in Prozent"></label>'+(editor?'<label>Radius (% der Bildbreite) <input data-pin-radius type="range" min="0.5" max="50" step="0.5" value="'+(target(q)?q.pinTarget.radius:5)+'" aria-label="Lösungsradius"><output data-pin-radius-value></output></label>':'')+'</div>':'')+(marks.length?'<div class="quiz-pin-legend">'+marks.map((m,i)=>'<span><b style="background:'+color(m.id)+'">'+(i+1)+'</b> '+esc(m.name)+'</span>').join('')+'</div>':'')+'</section>';
 }
 function mount(el,q,{answer=null,showTarget=false,editable=false,editor=false,onChange=()=>{},onAspect=()=>{}}={}){
  if(!el)return;
  const board=el.querySelector('.quiz-pin-board'),img=board?.querySelector('img');if(!board||!img)return;
  const own=board.querySelector('.quiz-pin-own'),circle=board.querySelector('.quiz-pin-target');
  const x=el.querySelector('[data-pin-x]'),y=el.querySelector('[data-pin-y]'),radius=el.querySelector('[data-pin-radius]');
  let selected=editor?q.pinTarget:answer,aspect=Number(q.pinAspect)||1;
  function draw(){
   own.hidden=!point(selected);if(point(selected)){own.style.left=selected.x+'%';own.style.top=selected.y+'%';if(x)x.value=selected.x;if(y)y.value=selected.y;}
   const t=editor&&point(selected)?{...selected,radius:Number(radius?.value)||5}:showTarget?q.pinTarget:null;
   circle.hidden=!point(t)||!Number.isFinite(t.radius);
   if(!circle.hidden){circle.style.left=t.x+'%';circle.style.top=t.y+'%';circle.style.width=2*t.radius+'%';circle.style.height=2*t.radius*aspect+'%';}
   const out=el.querySelector('[data-pin-radius-value]');if(out)out.textContent=(Number(radius.value)).toLocaleString('de-DE')+' %';
  }
  function choose(px,py){if(!editable)return;selected={x:Math.round(Math.max(0,Math.min(100,px))*100)/100,y:Math.round(Math.max(0,Math.min(100,py))*100)/100};draw();onChange(editor?{...selected,radius:Number(radius.value)}:selected);}
  if(editable){
   board.addEventListener('click',event=>{const r=img.getBoundingClientRect();if(r.width&&r.height)choose((event.clientX-r.left)/r.width*100,(event.clientY-r.top)/r.height*100);});
   board.addEventListener('keydown',event=>{let px=point(selected)?selected.x:50,py=point(selected)?selected.y:50;const step=event.shiftKey?10:1;
    switch(event.key){case 'ArrowLeft':px-=step;break;case 'ArrowRight':px+=step;break;case 'ArrowUp':py-=step;break;case 'ArrowDown':py+=step;break;case 'Home':px=py=50;break;case 'Enter':case ' ':break;default:return;}event.preventDefault();choose(px,py);});
   for(const input of [x,y])input.addEventListener('input',()=>{if(x.value!==''&&y.value!==''&&Number.isFinite(x.valueAsNumber)&&Number.isFinite(y.valueAsNumber))choose(x.valueAsNumber,y.valueAsNumber);});
   radius?.addEventListener('input',()=>{draw();if(point(selected))onChange({...selected,radius:Number(radius.value)});});
  }
  const loaded=()=>{if(img.naturalWidth&&img.naturalHeight){aspect=img.naturalWidth/img.naturalHeight;onAspect(aspect);draw();}};
  img.addEventListener('load',loaded,{once:true});if(img.complete)loaded();draw();
 }
 root.QuizPin={image,point,target,valid,correct,color,markup,mount};
 if(typeof module!=='undefined')module.exports=root.QuizPin;
})(typeof window!=='undefined'?window:globalThis);
