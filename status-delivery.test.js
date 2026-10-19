import test from 'node:test';import assert from 'node:assert/strict';import {deliverRenderStatus} from './status-delivery.js';
test('temporary failures retry the identical attempt and terminal result',async()=>{
 let calls=0;const bodies=[];const payload={job_id:'job',project_id:'project',attempt_token:'attempt-2',patch:{status:'rendered'}};
 const r=await deliverRenderStatus('https://callback','secret',payload,{sleep:async()=>{},fetcher:async(_url,options)=>{bodies.push(JSON.parse(options.body));calls++;if(calls===1)throw Error('timeout');return new Response('',{status:calls===2?503:200});}});
 assert.equal(r.ok,true);assert.equal(r.attempts,3);assert.deepEqual(bodies,[payload,payload,payload]);
});
test('auth and validation failures stop, persistent outages are bounded',async()=>{
 for(const status of [400,401,403,409]){let calls=0;const r=await deliverRenderStatus('url','key',{}, {sleep:async()=>{},fetcher:async()=>{calls++;return new Response('',{status});}});assert.equal(r.ok,false);assert.equal(calls,1);}
 let calls=0;const r=await deliverRenderStatus('url','key',{}, {sleep:async()=>{},fetcher:async()=>{calls++;return new Response('',{status:429});}});assert.equal(r.ok,false);assert.equal(calls,4);
});
