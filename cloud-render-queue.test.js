import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DurableRenderQueue,GoogleRenderTransport,attemptId,LEASE_MS} from './cloud-render-queue.js';

function store() {
  const objects=new Map();
  return {objects,async read(id){return structuredClone(objects.get(id) || null);},
    async write(id,value,generation='0'){
      const old=objects.get(id);
      if((old?.generation || '0')!==generation)throw Error('ownership changed');
      const next={value:structuredClone(value),generation:String(Number(generation)+1)};
      objects.set(id,next);return structuredClone(next);
    }};
}
const payload={project_id:'project',job_id:'job',attempt_token:'attempt',scenes:[]};
const terminal={job_id:'job',project_id:'project',attempt_token:'attempt',patch:{status:'rendered'}};

test('completed attempt never renders again',async()=>{
  const q=new DurableRenderQueue(store());let renders=0;
  const render=async(p,finish)=>{renders++;await finish(terminal);};
  assert.equal(await q.execute(payload,render,async()=>true),true);
  assert.equal(await q.execute(payload,render,async()=>true),true);
  assert.equal(renders,1);
});
test('callback outage survives process replacement without rerender',async()=>{
  const s=store();let renders=0;
  assert.equal(await new DurableRenderQueue(s).execute(payload,async(p,finish)=>{renders++;await finish(terminal);},async()=>false),false);
  assert.equal(await new DurableRenderQueue(s).execute(payload,async()=>{renders++;},async c=>{assert.deepEqual(c,terminal);return true;}),true);
  assert.equal(renders,1);
});
test('crashed render holds its lease, then a retry can recover it',async()=>{
  const s=store();let now=0;const q=new DurableRenderQueue(s,{now:()=>now});
  await assert.rejects(q.execute(payload,async()=>{throw Error('crash');},async()=>true),/crash/);
  await assert.rejects(q.execute(payload,async()=>assert.fail('must not render'),async()=>true),/active task/);
  now=LEASE_MS+1;
  assert.equal(await q.execute(payload,async(p,finish)=>finish(terminal),async()=>true),true);
});
test('concurrent task deliveries cannot both acquire a render lease',async()=>{
  const s=store();let release;
  const barrier=new Promise(resolve=>{release=resolve;});let renders=0;
  const render=async(p,finish)=>{renders++;await barrier;return finish(terminal);};
  const a=new DurableRenderQueue(s).execute(payload,render,async()=>true);
  const b=new DurableRenderQueue(s).execute(payload,render,async()=>true);
  release();const results=await Promise.allSettled([a,b]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(renders,1);
});
test('a failed render is terminal once its failure is delivered',async()=>{
  const q=new DurableRenderQueue(store());
  assert.equal(await q.execute(payload,async(p,finish)=>finish({...terminal,patch:{status:'failed'}}),async()=>true),true);
  assert.equal(await q.execute(payload,async()=>assert.fail('already failed'),async()=>true),true);
});
test('changed payload cannot reuse an attempt token',async()=>{
  const q=new DurableRenderQueue(store());
  await q.execute(payload,async(p,finish)=>finish(terminal),async()=>true);
  await assert.rejects(q.execute({...payload,scenes:[{}]},async()=>{},async()=>true),/payload changed/);
  assert.notEqual(attemptId(payload),attemptId({...payload,attempt_token:'retry'}));
});
test('receipt persistence failure never sends a completion callback',async()=>{
  const s=store(),write=s.write.bind(s);let callbacks=0;
  s.write=async(id,value,generation)=>{if(value.status==='callback_pending')throw Error('storage outage');return write(id,value,generation);};
  await assert.rejects(new DurableRenderQueue(s).execute(payload,async(p,finish)=>finish(terminal),async()=>{callbacks++;return true;}),/storage outage/);
  assert.equal(callbacks,0);
});
test('enqueue uses deterministic task identity and does not acknowledge API failure',async()=>{
  let status=200,task;
  const t=new GoogleRenderTransport({project:'p',location:'us-central1',queue:'renders',bucket:'b',target:'https://renderer.example',token:'test-only',fetcher:async(url,opts)=>{
    if(url.startsWith('http://metadata.'))return Response.json({access_token:'runtime-token',expires_in:3600});
    task=JSON.parse(opts.body).task;return new Response('{}',{status});
  }});
  assert.deepEqual(await t.enqueue(payload),{deduped:false});
  assert.equal(task.dispatchDeadline,'1800s');assert.equal(task.name.split('/').at(-1),`render-${attemptId(payload)}`);
  assert.deepEqual(JSON.parse(Buffer.from(task.httpRequest.body,'base64')),payload);
  status=409;assert.deepEqual(await t.enqueue(payload),{deduped:true});
  status=503;await assert.rejects(t.enqueue(payload),/enqueue failed/);
  await assert.rejects(t.enqueue({...payload,large:'x'.repeat(650001)}),/size limit/);
});
