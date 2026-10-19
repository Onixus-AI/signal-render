import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(50);}throw Error('worker state timed out');}
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('a real worker restart drains a persisted terminal callback without rerendering',{timeout:45000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'worker-restart-'));let terminalCalls=0,downloads=0,deliver=false;
 const upstream=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.method==='GET'){downloads++;res.writeHead(404);res.end('test asset unavailable');return;}
  const data=JSON.parse(body);if(data.patch?.status==='failed'){terminalCalls++;res.writeHead(deliver?200:503);}else res.writeHead(200);res.end('{}');
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const upstreamBase='http://127.0.0.1:'+upstream.address().port,workerPort=await port(),base='http://127.0.0.1:'+workerPort;
 let child,logs='';
 const start=()=>{child=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(workerPort),RENDER_TOKEN:'test-only',SUPABASE_URL:upstreamBase,RENDER_STATE_DIR:dir},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);};
 const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}};
 t.after(async()=>{await stop();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});});
 const health=()=>fetch(base+'/health').then(r=>r.json()).catch(()=>null);
 const post=p=>fetch(base+'/render-video',{method:'POST',headers:{Authorization:'Bearer test-only','Content-Type':'application/json'},body:JSON.stringify(p)});
 const p={job_id:'restart-job',project_id:'restart-project',attempt_token:'attempt-one',expected_scene_count:1,scenes:[{idx:0,start_ms:0,end_ms:1000,image_url:upstreamBase+'/asset'}],brand:{logo_url:upstreamBase+'/logo'},upload_tokens:{video:{signed_url:upstreamBase+'/upload',token:'test'},thumbnail:{signed_url:upstreamBase+'/upload-thumb',token:'test'}}};
 start();try{await until(async()=>!!(await health()));}catch(e){throw Error(e.message+logs);}
 assert.equal((await health()).durable_video_jobs,true);assert.equal((await post(p)).status,202);
 await until(()=>terminalCalls>0);await stop();const before=downloads;deliver=true;
 start();await until(async()=>{const h=await health();return h&&h.undelivered_video_callbacks===0&&terminalCalls>=2;});
 assert.equal(downloads,before,'terminal outbox recovery must not download or encode again');
 const duplicate=await post(p);assert.equal(duplicate.status,202);assert.equal((await duplicate.json()).deduped,true);assert.equal(downloads,before);
});
