import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {jobMediaHandler} from './job-media.js';
test('Remotion can retrieve approved team clips only while the job token is registered',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'signal-job-media-'));
 const roots=new Map([['active-job',dir]]);
 const app=express();app.get('/_job-media/:token/:name',jobMediaHandler(roots));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/_job-media`;
 try{
  for(const move of ['wave','handle','point']){
   const name=`team-onyx-${move}.webm`;
   await writeFile(join(dir,name),`prepared-${move}`);
   const response=await fetch(`${base}/active-job/${name}`);
   assert.equal(response.status,200);assert.equal(await response.text(),`prepared-${move}`);
  }
  for(const name of ['team-onixa-wave.webm','team-onyx-dance.webm','team-onyx-wave.mp4','secret.json','%2e%2e%2fsecret.json']){
   assert.equal((await fetch(`${base}/active-job/${name}`)).status,404);
  }
  roots.delete('active-job');
  assert.equal((await fetch(`${base}/active-job/team-onyx-wave.webm`)).status,404);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
