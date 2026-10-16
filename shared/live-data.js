(function(root){
 'use strict';
 async function fetchAllRows(factory,pageSize=1000){
  const rows=[];
  for(let offset=0;;offset+=pageSize){
   const {data,error}=await factory().range(offset,offset+pageSize-1);
   if(error)throw error;
   const batch=data||[];rows.push(...batch);
   if(batch.length<pageSize)return rows;
  }
 }
 root.fetchAllRows=fetchAllRows;
 if(typeof module!=='undefined')module.exports={fetchAllRows};
})(typeof window!=='undefined'?window:globalThis);
