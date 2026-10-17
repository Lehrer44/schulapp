/* Plain text remains authoritative. Formatting contains only offsets, never HTML. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function normalise(value){
  const text=String(value?.text??''),source=value?.textFormat||{};
  const ranges=Array.isArray(source.ranges)?source.ranges.filter(r=>r&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=text.length&&(r.bold===true||r.underline===true)).map(r=>({start:r.start,end:r.end,bold:r.bold===true,underline:r.underline===true})):[];
  return {text,align:source.align==='center'?'center':'left',ranges};
 }
 function render(value,editor=false){
  const {text,align,ranges}=normalise(value);
  let offset=0;
  const lines=text.split('\n').map(line=>{
   const start=offset,end=start+line.length;offset=end+1;
   const cuts=[...new Set([start,end,...ranges.flatMap(r=>[Math.max(start,Math.min(end,r.start)),Math.max(start,Math.min(end,r.end))])])].sort((a,b)=>a-b);
   let html='';
   for(let i=0;i<cuts.length-1;i++){
    const from=cuts[i],to=cuts[i+1],active=ranges.filter(r=>r.start<=from&&r.end>=to);
    let part=escape(text.slice(from,to));
    if(active.some(r=>r.bold))part='<strong>'+part+'</strong>';
    if(active.some(r=>r.underline))part='<u>'+part+'</u>';
    html+=part;
   }
   return editor?'<div>'+(html||'<br>')+'</div>':'<span class="quiz-rich-line">'+(html||'<br>')+'</span>';
  }).join('');
  return editor?lines:'<span class="quiz-rich quiz-rich-'+align+'">'+lines+'</span>';
 }
 function read(element){
  let text='',ranges=[];
  function append(value,marks){
   const start=text.length;text+=value.replace(/\u00a0/g,' ');
   if(text.length>start&&(marks.bold||marks.underline))ranges.push({start,end:text.length,...marks});
  }
  const block=n=>n.nodeType===1&&(/^(DIV|P|LI)$/.test(n.tagName)||n.classList.contains('quiz-rich-line'));
  function walk(parent,marks){
   const nodes=Array.from(parent.childNodes);
   nodes.forEach((node,i)=>{
    if(node.nodeType===3){append(node.data,marks);return;}
    if(node.nodeType!==1||/^(SCRIPT|STYLE|IFRAME|OBJECT)$/.test(node.tagName))return;
    const nextMarks={bold:marks.bold||/^(B|STRONG)$/.test(node.tagName)||/^(bold|[7-9]00)$/.test(node.style.fontWeight),underline:marks.underline||node.tagName==='U'||node.style.textDecoration.includes('underline')};
    if(node.tagName==='BR'){
     // The last BR is the browser's caret placeholder, not another empty line.
     if(i<nodes.length-1)append('\n',marks);
     return;
    }
    if(i>0&&(block(node)||block(nodes[i-1])))append('\n',{});
    walk(node,nextMarks);
   });
  }
  walk(element,{});
  return {text,textFormat:{align:element.dataset.align==='center'?'center':'left',ranges}};
 }
 root.QuizRichText={escape,normalise,render,read};
 if(typeof module!=='undefined')module.exports=root.QuizRichText;
})(typeof window!=='undefined'?window:globalThis);
