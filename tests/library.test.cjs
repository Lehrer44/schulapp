const assert=require('node:assert/strict');const {createLibraryStore}=require('../cloud-library.js');
function backend(){
 const state={row:null,offline:false,loseResponse:false,writes:0};
 const client={from(){return {select(){return this},eq(){return this},async maybeSingle(){return state.offline?{error:Error('offline')}:{data:state.row?structuredClone(state.row):null}}}},storage:{from(){return {async download(){return {error:{statusCode:'404',message:'Object not found'}}}}}},async rpc(name,a){
  if(state.offline)return {error:Error('offline')};
  if(state.row?.last===a.p_operation_id)return {data:{ok:true,revision:state.row.revision}};
  if((state.row?.revision||0)!==a.p_expected_revision)return {data:{ok:false,error:'LIBRARY_CONFLICT'}};
  state.row={payload:structuredClone(a.p_payload),revision:(state.row?.revision||0)+1,last:a.p_operation_id};state.writes++;
  if(state.loseResponse){state.loseResponse=false;return {error:Error('response lost')}};
  return {data:{ok:true,revision:state.row.revision}};
 }};return {client,state};
}
(async()=>{
 const {client,state}=backend(),a=createLibraryStore(client,'quiz'),b=createLibraryStore(client,'quiz');
 await a.load({id:'teacher'});await b.load({id:'teacher'});
 await a.save({quizzes:[{title:'A'}]});await assert.rejects(b.save({quizzes:[{title:'B'}]}),/LIBRARY_CONFLICT/);assert.equal(state.row.payload.quizzes[0].title,'A');assert.equal(b.blocked,true);
 const c=createLibraryStore(client,'quiz');await c.load({id:'teacher'});state.loseResponse=true;
 await assert.rejects(c.save({quizzes:[{title:'C'}]}),/response lost/);assert(c.unsaved);
 await c.save({quizzes:[{title:'D'}]});assert.equal(state.row.payload.quizzes[0].title,'D');assert.equal(state.writes,3);assert(!c.unsaved);
 await Promise.all([c.save({quizzes:[{title:'E'}]}),c.save({quizzes:[{title:'F'}]})]);assert.equal(state.row.payload.quizzes[0].title,'F');
 const bad=createLibraryStore(client,'jeopardy');state.offline=true;await assert.rejects(bad.load({id:'teacher'}),/offline/);await assert.rejects(bad.save({games:[]}),/LIBRARY_NOT_LOADED/);
 console.log('PASS: stale tabs, serialization, lost response, load failure, preserved cloud contents');
})().catch(e=>{console.error(e);process.exitCode=1});
