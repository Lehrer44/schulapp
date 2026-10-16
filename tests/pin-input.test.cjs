const assert=require('node:assert/strict');const {installPinInput}=require('../shared/pin-input.js');
const events={};const board={dataset:{},addEventListener(name,cb){events[name]=cb},querySelector(){return null},getBoundingClientRect(){return {left:0,top:0,width:200,height:100}}};
function input(){return {value:50,disabled:false,addEventListener(){}}}const x=input(),y=input(),values=[];installPinInput(board,x,y,v=>values.push(v));
const press=(key,shiftKey=false)=>events.keydown({key,shiftKey,preventDefault(){}});
press('ArrowRight');assert.equal(board.dataset.x,'51');press('ArrowDown',true);assert.equal(board.dataset.y,'60');press('Home');assert.deepEqual(values.at(-1),{x:50,y:50});
events.click({clientX:0,clientY:0});assert.deepEqual(values.at(-1),{x:0,y:0});press('ArrowLeft');assert.equal(board.dataset.x,'0');
x.disabled=true;const count=values.length;press('ArrowRight');events.click({clientX:50,clientY:50});assert.equal(values.length,count);
console.log('PASS: keyboard pin placement, shift steps, home, pointer, boundaries and read-only answers');

