import {createHash, randomUUID} from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const attemptId = p => digest([p.project_id,p.job_id,p.attempt_token ?? null]);
// The task deadline is 30 minutes. A container is stopped at 29 minutes by
// the HTTP handler, before this lease can be acquired by a retry.
export const LEASE_MS = 35 * 60_000;
export const RENDER_DEADLINE_MS = 29 * 60_000;

export class GoogleRenderTransport {
  constructor({project,location,queue,bucket,target,token,fetcher=fetch}) {
    Object.assign(this,{project,location,queue,bucket,target,token,fetcher});
    if(!project || !location || !queue || !bucket || !token || !/^https:\/\//.test(target || '')) throw Error('Incomplete Google render queue configuration');
    this.parent=`projects/${project}/locations/${location}/queues/${queue}`;
  }
  async accessToken() {
    if(this.cached && this.cached.until>Date.now()+60_000)return this.cached.value;
    const r=await this.fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{
      headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(10_000),
    });
    if(!r.ok)throw Error(`Google runtime identity unavailable (${r.status})`);
    const body=await r.json();
    if(!body.access_token)throw Error('Google runtime identity returned no token');
    this.cached={value:body.access_token,until:Date.now()+body.expires_in*1000};
    return this.cached.value;
  }
  async request(url,options={}) {
    return this.fetcher(url,{...options,headers:{...options.headers,Authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(20_000)});
  }
  async enqueue(payload) {
    const raw=JSON.stringify(payload);
    // Cloud Tasks has a 1 MiB task limit, including headers and base64 body.
    if(Buffer.byteLength(raw)>650_000)throw Error('Render payload exceeds durable task size limit');
    const r=await this.request(`https://cloudtasks.googleapis.com/v2/${this.parent}/tasks`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:{
        name:`${this.parent}/tasks/render-${attemptId(payload)}`,
        dispatchDeadline:'1800s',
        httpRequest:{httpMethod:'POST',url:`${this.target.replace(/\/$/,'')}/tasks/render-video`,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.token}`},body:Buffer.from(raw).toString('base64')},
      }}),
    });
    if(r.status===409)return {deduped:true};
    if(!r.ok)throw Error(`Durable render enqueue failed (${r.status})`);
    return {deduped:false};
  }
  objectUrl(id) {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(`receipts/${id}.json`)}`;
  }
  async read(id) {
    const metadata=await this.request(this.objectUrl(id));
    if(metadata.status===404)return null;
    if(!metadata.ok)throw Error(`Render receipt lookup failed (${metadata.status})`);
    const {generation}=await metadata.json();
    const r=await this.request(`${this.objectUrl(id)}?alt=media&generation=${encodeURIComponent(generation)}`);
    if(!r.ok)throw Error(`Render receipt read failed (${r.status})`);
    return {value:await r.json(),generation};
  }
  async write(id,value,generation='0') {
    const url=`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(`receipts/${id}.json`)}&ifGenerationMatch=${encodeURIComponent(generation)}`;
    const r=await this.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    if(r.status===412)throw Error('Render receipt ownership changed');
    if(!r.ok)throw Error(`Render receipt persistence failed (${r.status})`);
    return {value,generation:(await r.json()).generation};
  }
}

export class DurableRenderQueue {
  constructor(store,{now=Date.now}={}) {this.store=store;this.now=now;}
  async execute(payload,render,deliver) {
    const id=attemptId(payload),payloadHash=digest(payload);
    let record=await this.store.read(id);
    if(record && record.value.payloadHash!==payloadHash)throw Error('Attempt payload changed; a new attempt token is required');
    if(record?.value.status==='delivered')return true;
    const deliverPending=async()=>{
      if(!await deliver(record.value.callback))return false;
      record=await this.store.write(id,{...record.value,status:'delivered',updatedAt:this.now()},record.generation);
      return true;
    };
    if(record?.value.status==='callback_pending')return deliverPending();
    if(record?.value.leaseUntil>this.now())throw Error('Render attempt is still owned by an active task');
    record=await this.store.write(id,{status:'rendering',payloadHash,owner:randomUUID(),leaseUntil:this.now()+LEASE_MS,updatedAt:this.now()},record?.generation || '0');
    // Persist the terminal callback before sending it. A retry after an
    // outage replays this receipt without rendering or purchasing assets.
    let terminalStored=false,delivered=false;
    await render(payload,async callback=>{
      if(terminalStored)throw Error('Render already produced a terminal receipt');
      if(record.value.leaseUntil<=this.now())throw Error('Render lease expired');
      record=await this.store.write(id,{...record.value,status:'callback_pending',callback,updatedAt:this.now()},record.generation);
      terminalStored=true;
      delivered=await deliverPending();
      return delivered;
    });
    return terminalStored && delivered;
  }
}
