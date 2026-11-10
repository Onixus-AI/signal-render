import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {keyConnectedBackdrop} from './edge-backdrop.js';
// The star character arrives as a picture on a flat studio background (image
// models can't return transparency). Key out the background colour, sampled
// from the top-left corner, so the character sits cleanly on any scene.
import { spawn } from "node:child_process";

const run = (bin, args) => new Promise((resolve, reject) => {
  const p = spawn(bin, args); const out = []; let err = "";
  p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${bin} ${code}: ${err.slice(-300)}`))));
});

/** Hex colour of the image's corner (its backdrop). */
export async function cornerColor(file, ffmpeg = "ffmpeg") {
  const raw = await run(ffmpeg, ["-v", "error", "-i", file, "-vf", "crop=8:8:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return starKeyHex(raw[0], raw[1], raw[2]);
}

export function starKeyHex(r, g, b) {
  return "0x" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Transparent PNG of the character. */
export async function cutoutStar(src, dest, ffmpeg = "ffmpeg") {
  const key = await cornerColor(src, ffmpeg);
  await run(ffmpeg, ["-y", "-v", "error", "-i", src, "-vf", `colorkey=${key}:0.16:0.08,format=rgba`, "-frames:v", "1", dest]);
  return { key, dest };
}

/** A move clip with its white backdrop keyed to transparency (VP9 + alpha). */
export async function cutoutStarClip(src, dest, ffmpeg = "ffmpeg") {
  const key = await cornerColor(src, ffmpeg);
  await run(ffmpeg, ["-y", "-v", "error", "-i", src, "-an", "-vf", `colorkey=${key}:0.18:0.08,format=yuva420p`,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", "-deadline", "realtime", "-cpu-used", "8", dest]);
  return { key, dest };
}

/** Approved Onyx clips: remove only edge-connected studio backdrop, preserving reflections. */
export async function cutoutTeamClip(src,dest,ffmpeg='ffmpeg') {
 const width=384,height=512,frameBytes=width*height*4;
 const decoder=spawn(ffmpeg,['-v','error','-i',src,'-an','-vf','scale=384:512:force_original_aspect_ratio=decrease,pad=384:512:(ow-iw)/2:(oh-ih)/2:color=white,fps=25','-f','rawvideo','-pix_fmt','rgba','pipe:1']);
 const encoder=spawn(ffmpeg,['-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','384x512','-r','25','-i','pipe:0','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','2M','-deadline','realtime','-cpu-used','8',dest]);
 const done=p=>new Promise((resolve,reject)=>{let err='';p.stderr.on('data',b=>{err=(err+b).slice(-2000);});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error('Character matte failed: '+err)));});
 const decoderDone=done(decoder),encoderDone=done(encoder);
 let pending=Buffer.alloc(0),key=null;
 const matte=new Transform({transform(chunk,_encoding,callback){try{
  pending=Buffer.concat([pending,chunk]);
  while(pending.length>=frameBytes){const frame=Buffer.from(pending.subarray(0,frameBytes));pending=pending.subarray(frameBytes);if(!key)key=[frame[0],frame[1],frame[2]];keyConnectedBackdrop(frame,width,height,key);this.push(frame);}callback();
 }catch(e){callback(e);}},flush(callback){callback(pending.length?new Error('Incomplete character frame'):undefined);}});
 const timer=setTimeout(()=>{decoder.kill('SIGKILL');encoder.kill('SIGKILL');},120000);
 try{await Promise.all([pipeline(decoder.stdout,matte,encoder.stdin),decoderDone,encoderDone]);}catch(e){decoder.kill('SIGKILL');encoder.kill('SIGKILL');throw e;}finally{clearTimeout(timer);}
 return {dest};
}
