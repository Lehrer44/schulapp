(function(root){
 function installPinInput(board,xInput,yInput,onChange){
  const clamp=n=>Math.max(0,Math.min(100,n));
  function set(x,y){if(xInput.disabled||yInput.disabled)return;x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y))return;const value={x:Number(clamp(x).toFixed(2)),y:Number(clamp(y).toFixed(2))};xInput.value=value.x;yInput.value=value.y;board.dataset.x=String(value.x);board.dataset.y=String(value.y);onChange(value);}
  board.addEventListener('click',event=>{const image=board.querySelector('.pinMapImage');const rect=image?.getBoundingClientRect()||board.getBoundingClientRect();if(rect.width&&rect.height)set((event.clientX-rect.left)/rect.width*100,(event.clientY-rect.top)/rect.height*100);});
  board.addEventListener('keydown',event=>{const step=event.shiftKey?10:1;let x=Number(xInput.value)||0,y=Number(yInput.value)||0;switch(event.key){case 'ArrowLeft':x-=step;break;case 'ArrowRight':x+=step;break;case 'ArrowUp':y-=step;break;case 'ArrowDown':y+=step;break;case 'Home':x=y=50;break;case 'Enter':case ' ':break;default:return;}event.preventDefault();set(x,y);});
  const changed=()=>{if(xInput.value!==''&&yInput.value!=='')set(xInput.value,yInput.value)};
  xInput.addEventListener('input',changed);yInput.addEventListener('input',changed);
 }
 root.installPinInput=installPinInput;if(typeof module!=='undefined')module.exports={installPinInput};
})(typeof window!=='undefined'?window:globalThis);
