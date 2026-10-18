const {execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict');
const exec=promisify(execFile);
async function sql(query){return (await exec('psql',['-qAt','-v','ON_ERROR_STOP=1','-c',query])).stdout.trim();}
(async()=>{
 const [sid,a,b,c]=(await sql('select session_id,a,b,c from test_fixture')).split('|');
 const calls=Array.from({length:18},(_,i)=>{const id=[a,b,c][i%3],token=['a','b','c'][i%3];return sql(`select public.quiz_live_submit_response_secure('${sid}','${id}',0,'"4"','${token}')`)});
 for(const value of await Promise.all(calls))assert.equal(JSON.parse(value).ok,true,value);
 assert.equal(await sql(`select count(*) from quiz_live_responses where session_id='${sid}'`),'3');
 assert.equal(await sql(`select count(distinct participant_id) from quiz_live_responses where session_id='${sid}'`),'3');
 const student=JSON.parse(await sql(`set role anon; select public.quiz_live_student_state_secure('${sid}','${a}','a')`));assert.equal(student.ok,true);assert.equal(student.question.text,undefined);assert.equal(student.question.answers,undefined);
 await assert.rejects(()=>sql(`set role anon; select public.quiz_live_teacher_state('${sid}')`),/permission denied/);
 console.log('PASS: 18 simultaneous attempts produce exactly one immutable entry per participant');
})().catch(e=>{console.error(e);process.exitCode=1});
