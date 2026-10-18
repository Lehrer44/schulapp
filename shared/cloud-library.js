/* Shared version-checked cloud persistence; no privileged keys. */
(function(root){
 'use strict';
 function createLibraryStore(client,kind){
  let owner=null,revision=null,blocked=false,pending=null,confirmed=null,tail=Promise.resolve();
  const error=code=>Object.assign(new Error(code),{code});
  async function load(user){
   revision=null;owner=user.id;blocked=false;pending=null;confirmed=null;
   const result=await client.from('teacher_libraries').select('revision,payload').eq('owner_id',owner).eq('kind',kind).maybeSingle();
   if(result.error)throw result.error;
   if(result.data){revision=Number(result.data.revision);confirmed=JSON.stringify(result.data.payload);return result.data.payload;}
   const bucket=kind==='quiz'?'quiz-studio':'jeopardy-games';
   const filename=kind==='quiz'?'Quiz-Studio.json':'Jeopardy-Spiele.json';
   const legacy=await client.storage.from(bucket).download(owner+'/'+filename);
   if(legacy.error){
    const status=String(legacy.error.statusCode||legacy.error.status||'');
    // A genuine missing file permits an empty library; connection/permission errors never do.
    if(status==='404'||legacy.error.message==='Object not found'){revision=0;return null;}
    throw legacy.error;
   }
   const payload=JSON.parse(await legacy.data.text());
   if(!Array.isArray(payload[kind==='quiz'?'quizzes':'games']))throw error('INVALID_LIBRARY');
   revision=0;return payload;
  }
  async function commit(job){
   if(blocked)throw error('LIBRARY_CONFLICT');
   pending=job;
   const result=await client.rpc('save_teacher_library',{p_owner_id:owner,p_kind:kind,p_expected_revision:job.revision,p_operation_id:job.id,p_payload:job.payload});
   if(result.error)throw result.error;
   if(!result.data?.ok){if(result.data?.error==='LIBRARY_CONFLICT')blocked=true;throw error(result.data?.error||'SAVE_FAILED');}
   revision=Number(result.data.revision);confirmed=JSON.stringify(job.payload);pending=null;
  }
  function save(payload){
   const snapshot=JSON.parse(JSON.stringify(payload));
   const operationId=root.crypto.randomUUID();
   const work=tail.catch(()=>{}).then(async()=>{
    if(revision===null)throw error('LIBRARY_NOT_LOADED');
    if(blocked)throw error('LIBRARY_CONFLICT');
    if(pending)await commit(pending); // Same operation ID makes a lost-response retry idempotent.
    if(JSON.stringify(snapshot)===confirmed)return; // Also coalesces identical snapshots already in the queue.
    await commit({id:operationId,revision,payload:snapshot});
   });
   tail=work;return work;
  }
  return {load,save,get revision(){return revision;},get blocked(){return blocked;},get unsaved(){return !!pending;}};
 }
 root.createLibraryStore=createLibraryStore;
 if(typeof module!=='undefined')module.exports={createLibraryStore};
})(typeof window!=='undefined'?window:globalThis);

