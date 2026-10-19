import {mkdir,readFile,readdir,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// A single mounted Railway volume serializes deployment ownership. Entries are
// fsynced before acceptance; failed writes never become acknowledged jobs.
export class JobJournal {
  constructor(directory,{maxPending=50,retentionMs=7*86400000}={}) {
    this.directory=directory;this.maxPending=maxPending;this.retentionMs=retentionMs;
    this.entries=new Map();this.chain=Promise.resolve();
  }
  async init(){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    for(const name of await readdir(this.directory)){
      if(!name.endsWith('.json'))continue;
      const entry=JSON.parse(await readFile(join(this.directory,name),'utf8'));
      if(entry.version!==1 || typeof entry.id!=='string' || !['queued','rendering','callback_pending','done','failed'].includes(entry.status))throw Error('Invalid job journal entry');
      this.entries.set(entry.id,entry);
    }
    return this;
  }
  serial(work){const next=this.chain.then(work);this.chain=next.catch(()=>{});return next;}
  filename(id){return join(this.directory,createHash('sha256').update(id).digest('hex')+'.json');}
  async write(entry){
    const target=this.filename(entry.id),tmp=target+'.'+randomUUID()+'.tmp';
    const handle=await open(tmp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(entry));await handle.sync();}finally{await handle.close();}
    try{await rename(tmp,target);const dir=await open(this.directory,'r');try{await dir.sync();}finally{await dir.close();}}catch(e){await unlink(tmp).catch(()=>{});throw e;}
    this.entries.set(entry.id,entry);return entry;
  }
  accept(payload){return this.serial(async()=>{
    const id=String(payload.job_id),token=payload.attempt_token??null,previous=this.entries.get(id);
    if(previous){
      if(previous.attemptToken===token)return {accepted:true,deduped:true,entry:previous};
      if(!['done','failed'].includes(previous.status))return {accepted:false,conflict:true};
    }
    if([...this.entries.values()].filter(e=>['queued','rendering','callback_pending'].includes(e.status)).length>=this.maxPending)return {accepted:false,full:true};
    const entry=await this.write({version:1,id,attemptToken:token,status:'queued',payload,createdAt:Date.now(),updatedAt:Date.now()});
    return {accepted:true,deduped:false,entry};
  });}
  rendering(id,token){return this.serial(async()=>{const e=this.entries.get(id);if(!e || e.attemptToken!==token || !['queued','rendering'].includes(e.status))throw Error('Render attempt no longer owns journal entry');return this.write({...e,status:'rendering',updatedAt:Date.now()});});}
  terminal(id,token,callback){return this.serial(async()=>{const e=this.entries.get(id);if(!e || e.attemptToken!==token)throw Error('Stale terminal render attempt');return this.write({...e,payload:null,callback,status:'callback_pending',updatedAt:Date.now()});});}
  delivered(id,token){return this.serial(async()=>{const e=this.entries.get(id);if(!e || e.attemptToken!==token || e.status!=='callback_pending')return;return this.write({...e,status:e.callback.patch.status==='rendered'?'done':'failed',callback:null,updatedAt:Date.now()});});}
  pending(){return [...this.entries.values()].filter(e=>e.status==='callback_pending');}
  recoverable(){return [...this.entries.values()].filter(e=>['queued','rendering'].includes(e.status));}
  prune(){return this.serial(async()=>{for(const e of this.entries.values())if(['done','failed'].includes(e.status)&&e.updatedAt<Date.now()-this.retentionMs){await unlink(this.filename(e.id));this.entries.delete(e.id);}});}
}
