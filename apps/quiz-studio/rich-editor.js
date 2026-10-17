(function(){
 'use strict';
 let active=null,savedRange=null;
 const inputOf=node=>node?.nodeType===1?node.closest('.rich-input'):node?.parentElement?.closest('.rich-input');
 function remember(){
  const selection=getSelection(),input=inputOf(selection?.anchorNode);
  if(!input||!input.contains(selection.focusNode))return;
  active=input;savedRange=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
  const toolbar=input.parentElement.querySelector('.rich-toolbar');
  for(const button of toolbar.querySelectorAll('[data-format]')){
   const command=button.dataset.format;
   if(command==='bold'||command==='underline')button.setAttribute('aria-pressed',String(document.queryCommandState(command)));
   if(command==='center'||command==='left')button.setAttribute('aria-pressed',String((input.dataset.align||'left')===command));
  }
 }
 function change(input){input.dispatchEvent(new Event('input',{bubbles:true}));remember();}
 document.addEventListener('selectionchange',remember);
 document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-format]'))event.preventDefault();});
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-format]');if(!button)return;
  const input=button.closest('.rich-editor').querySelector('.rich-input'),command=button.dataset.format;
  const range=active===input&&savedRange&&input.contains(savedRange.commonAncestorContainer)?savedRange:null;
  input.focus();
  const selection=getSelection();selection.removeAllRanges();
  if(range)selection.addRange(range);else{const end=document.createRange();end.selectNodeContents(input);end.collapse(false);selection.addRange(end);}
  if(command==='center'||command==='left')input.dataset.align=command;
  else document.execCommand(command==='break'?'insertLineBreak':command,false,null);
  change(input);
 });
 document.addEventListener('paste',event=>{
  const input=inputOf(event.target);
  if(!input||event.defaultPrevented||!event.clipboardData)return;
  event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));change(input);
 });
 document.addEventListener('drop',event=>{if(inputOf(event.target))event.preventDefault();});
 document.addEventListener('keydown',event=>{
  const input=inputOf(event.target);if(!input)return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&['b','u'].includes(event.key.toLowerCase())){
   event.preventDefault();document.execCommand(event.key.toLowerCase()==='b'?'bold':'underline',false,null);change(input);
  }
 });
})();
