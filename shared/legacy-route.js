(function(){
  'use strict';
  const target=document.currentScript.dataset.target;
  const destination=new URL(target,location.href);
  destination.search=location.search;
  destination.hash=location.hash;
  location.replace(destination.href);
})();
