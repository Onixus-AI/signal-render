import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AD_CANVASES,adaptationArgs,adaptationUrl} from './ad-adaptation.js';
test('signed assets are restricted to the configured bucket and origin',()=>{const base='https://example.supabase.co';assert.ok(adaptationUrl(base+'/storage/v1/object/sign/signal-video/a.mp4?token=abc',base));for(const bad of ['http://example.supabase.co/storage/v1/object/sign/signal-video/a','https://localhost/a','https://example.supabase.co/storage/v1/object/sign/private/a'])assert.throws(()=>adaptationUrl(bad,base));assert.throws(()=>adaptationArgs('a','b','unknown'));});
test('four real exports preserve duration and exact AAC packets with no paid providers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'adapt-test-'));const master=join(dir,'master.mp4');
 try{
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-preset','ultrafast','-c:a','aac',master]);
  const audioHash=path=>execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','csv=p=0',path],{encoding:'utf8'});
  for(const [format,[w,h]] of Object.entries(AD_CANVASES)){
   const out=join(dir,format.replace(':','-')+'.mp4');execFileSync('ffmpeg',['-v','error',...adaptationArgs(master,out,format)],{timeout:60000});
   const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',out],{encoding:'utf8'}));const v=meta.streams.find(s=>s.codec_type==='video');assert.equal(v.width,w);assert.equal(v.height,h);assert.ok(Math.abs(Number(meta.format.duration)-1)<0.1);assert.equal(audioHash(out),audioHash(master));
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('a master already in the canvas shape fills it edge to edge, with no bars',()=>{
 const dir=mkdtempSync(join(tmpdir(),'adapt-fill-'));const master=join(dir,'m.mp4'),out=join(dir,'o.mp4');
 try{
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:size=540x960:rate=24','-t','0.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',master]);
  execFileSync('ffmpeg',['-v','error',...adaptationArgs(master,out,'9:16')],{timeout:60000});
  const px=execFileSync('ffmpeg',['-v','error','-i',out,'-frames:v','1','-vf','crop=4:4:0:0,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'],);
  assert.ok(px[0]>200&&px[1]<60&&px[2]<60,`corner is the master's red, not a bar: ${[...px]}`);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
