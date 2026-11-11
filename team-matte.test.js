import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {cutoutTeamClip} from './star-cutout.js';
const exec=promisify(execFile);
test('encoded character video retains enclosed white reflection and removes exterior studio white',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'team-matte-'));
 try{
  const src=join(dir,'source.mp4'),out=join(dir,'cutout.webm');
  await exec(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=white:s=384x512:r=25:d=0.4','-vf','drawbox=x=100:y=100:w=184:h=312:color=black:t=fill,drawbox=x=170:y=220:w=40:h=40:color=white:t=fill','-c:v','libx264','-pix_fmt','yuv420p',src]);
  await cutoutTeamClip(src,out,ffmpeg);
  const {stdout}=await exec(ffmpeg,['-v','error','-c:v','libvpx-vp9','-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{encoding:'buffer',maxBuffer:2*1024*1024});
  const alpha=(x,y)=>stdout[(y*384+x)*4+3];
  assert.equal(alpha(10,10),0);assert.equal(alpha(190,240),255);assert.equal(alpha(120,120),255);
 }finally{await rm(dir,{recursive:true,force:true});}
});
