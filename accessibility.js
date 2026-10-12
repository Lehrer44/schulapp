(function(){
 let counter=0;
 function connectLabels(){document.querySelectorAll('.field').forEach(field=>{const label=field.querySelector('label'),input=field.querySelector('input:not([type="hidden"]),textarea,select');if(!label||!input||label.htmlFor)return;if(!input.id)input.id='field-control-'+(++counter);label.htmlFor=input.id;});}
 document.addEventListener('DOMContentLoaded',()=>{connectLabels();new MutationObserver(connectLabels).observe(document.body,{childList:true,subtree:true});});
})();
