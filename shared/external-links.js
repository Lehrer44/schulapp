/* Personal dashboard links; authenticated reads and writes are also enforced by RLS. */
(function(){
 'use strict';
 function webUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&u.hostname?u.href:null;}catch{return null;}}
 function mount(root,client,user){
  let active=true,busy=false,links=[];
  const list=root.querySelector('[data-links-list]'),status=root.querySelector('[data-links-status]'),form=root.querySelector('form'),add=root.querySelector('[data-links-add]'),name=form.elements.linkName,url=form.elements.linkUrl;
  const say=text=>{if(active)status.textContent=text;};
  function draw(){
   if(!active)return;list.replaceChildren();
   if(!links.length){const p=document.createElement('p');p.className='links-empty';p.textContent='Noch keine Links.';list.append(p);return;}
   for(const link of links){
    const row=document.createElement('div');row.className='external-link-row';row.dataset.linkId=link.id;
    const title=document.createElement('span');title.className='external-link-name';title.textContent=link.name;
    const actions=document.createElement('div');actions.className='external-link-actions';
    const href=webUrl(link.url);
    if(href){const open=document.createElement('a');open.className='account-action external-link-open';open.href=href;open.target='_blank';open.rel='noopener noreferrer';open.textContent='Öffnen ↗';open.setAttribute('aria-label',link.name+' öffnen (neuer Tab)');actions.append(open);}
    const remove=document.createElement('button');remove.type='button';remove.className='account-action external-link-remove';remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';remove.setAttribute('aria-label',link.name+' löschen');remove.title='Link löschen';remove.onclick=async()=>{
     if(busy||!confirm('Link „'+link.name+'“ löschen?'))return;busy=true;remove.disabled=true;say('');
     try{const {error}=await client.from('teacher_external_links').delete().eq('owner_id',user.id).eq('id',link.id);if(error)throw error;if(!active)return;links=links.filter(x=>x.id!==link.id);draw();say('Link gelöscht.');}
     catch{say('Der Link konnte nicht gelöscht werden. Bitte erneut versuchen.');}finally{busy=false;remove.disabled=false;}
    };
    actions.append(remove);row.append(title,actions);list.append(row);
   }
  }
  async function load(){
   say('Links werden geladen …');add.disabled=true;
   try{const {data,error}=await client.from('teacher_external_links').select('id,name,url').eq('owner_id',user.id).order('created_at').order('id');if(error)throw error;if(!active)return;links=data||[];draw();say('');add.disabled=false;}
   catch{if(!active)return;say('Die Links konnten nicht geladen werden.');list.replaceChildren();const retry=document.createElement('button');retry.className='account-action';retry.textContent='Erneut laden';retry.onclick=load;list.append(retry);}
  }
  add.onclick=()=>{form.hidden=false;name.focus();};
  root.querySelector('[data-links-cancel]').onclick=()=>{form.reset();form.hidden=true;say('');add.focus();};
  form.onsubmit=async e=>{
   e.preventDefault();if(busy)return;
   const title=name.value.trim(),href=webUrl(url.value.trim());
   if(!title||!href){say('Bitte gib einen Namen und eine gültige Adresse mit https:// oder http:// ein.');return;}
   busy=true;e.submitter.disabled=true;say('Link wird gespeichert …');
   try{const {data,error}=await client.from('teacher_external_links').insert({owner_id:user.id,name:title,url:href}).select('id,name,url').single();if(error)throw error;if(!active)return;links.push(data);draw();form.reset();form.hidden=true;say('Link gespeichert.');add.focus();}
   catch{say('Der Link konnte nicht gespeichert werden. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.');}
   finally{busy=false;e.submitter.disabled=false;}
  };
  load();
  return ()=>{active=false;list.replaceChildren();form.reset();form.hidden=true;status.textContent='';};
 }
 window.ExternalLinks={mount};
})();
