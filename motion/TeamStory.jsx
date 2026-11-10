import React from 'react';
import {AbsoluteFill, Img, Loop, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'};
function Character({scene,style}){
 const {fps}=useVideoConfig();
 if(!scene.characterName)return null;
 if(!scene.characterClip?.url)throw new Error('Animated Onyx clip is required; still fallback is disabled');
 return <div style={style}><Loop durationInFrames={Math.max(1,Math.round(scene.characterClip.sec*fps))}><OffthreadVideo src={scene.characterClip.url} transparent muted style={{width:'100%',height:'100%',objectFit:'contain'}}/></Loop></div>;
}
function Headline({text,fonts,frame,last}){
 return <div style={{fontFamily:fonts.headingStack,fontSize:last?76:text.length>55?66:84,lineHeight:1.06,fontWeight:750,letterSpacing:'-.04em'}}>{text.split(' ').map((word,i)=>{
 const t=interpolate(frame,[3+i*1.5,12+i*1.5],[0,1],clamp);
 return <span key={i} style={{display:'inline-block',marginRight:'.23em',opacity:t,transform:`translateY(${(1-t)*26}px)`}}>{word}</span>;
 })}</div>;
}
function StoryShot({scene,first,last,opening,brand,cta,fonts,durationF}){
 const frame=useCurrentFrame();
 const entrance=interpolate(frame,[0,16],[0,1],{...clamp,easing:Easing.out(Easing.cubic)});
 const progress=interpolate(frame,[0,durationF],[0,1],clamp);
 const workflow=scene.beat==='capability';
 const image=last?opening:scene.imageSrc;
 const hasCharacter=!!scene.characterName;
 return <AbsoluteFill style={{background:'#101416',color:'#fff',fontFamily:fonts.bodyStack}}>
  {scene.videoSrc&&<><OffthreadVideo src={scene.videoSrc} muted style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/><AbsoluteFill style={{background:workflow?'rgba(16,20,22,.72)':'linear-gradient(180deg,rgba(16,20,22,.88),rgba(16,20,22,.15) 52%,rgba(16,20,22,.92))'}}/></>}
  <div style={{position:'absolute',left:72,right:72,top:130,display:'flex',alignItems:'center',gap:20}}>
   <Img src={brand.logoUrl} style={{width:82,height:82,objectFit:'contain'}}/>
   <span style={{fontFamily:fonts.headingStack,fontSize:32,fontWeight:650}}>Onixus</span>
   <span style={{marginLeft:'auto',fontSize:22,letterSpacing:'.16em',textTransform:'uppercase',color:brand.accent}}>{last?'Your next step':workflow?'Owner in control':'Work. Connected.'}</span>
  </div>
  <div style={{position:'absolute',top:last?345:300,left:72,right:92,zIndex:3}}><Headline text={last?(scene.text||cta):scene.text} fonts={fonts} frame={frame} last={last}/></div>
  {!last&&!workflow&&!scene.videoSrc&&image&&<div style={{position:'absolute',left:72,top:600,width:936,height:first?820:720,borderRadius:36,overflow:'hidden',border:'1px solid rgba(255,255,255,.2)',transform:`translateY(${(1-entrance)*75}px)`,opacity:entrance}}>
   <Img src={image} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${1.02+progress*.055})`}}/>
   <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg,transparent 55%,rgba(16,20,22,.8))'}}/>
   <div style={{position:'absolute',top:28,left:28,width:50,height:5,background:brand.accent}}/>
  </div>}
  {workflow&&<div style={{position:'absolute',top:640,left:72,width:535,zIndex:2}}>{['Inquiry','Owner review','Follow-up'].map((label,i)=>{
   const t=interpolate(progress,[i*.18,i*.18+.16],[0,1],clamp);
   return <div key={label} style={{opacity:t,transform:`translateX(${(1-t)*-70}px)`,marginBottom:30}}><div style={{border:`2px solid ${i===1?brand.accent:'rgba(255,255,255,.25)'}`,borderRadius:22,padding:'30px 28px',fontSize:39,fontWeight:650,background:i===1?'rgba(0,203,232,.12)':'#1b2329'}}><span style={{color:brand.accent,marginRight:18,fontSize:27}}>0{i+1}</span>{label}</div>{i<2&&<div style={{height:32,borderLeft:`2px solid ${brand.accent}`,marginLeft:40,marginTop:16}}/>}</div>;
  })}</div>}
  {hasCharacter&&<Character scene={scene} style={{position:'absolute',left:last?300:workflow?590:575,top:last?830:workflow?905:960,width:last?480:420,height:last?640:560,zIndex:4,opacity:entrance,transform:`translateY(${(1-entrance)*35}px)`}}/>}
  {last&&<>
   <Img src={brand.logoUrl} style={{position:'absolute',top:660,left:72,width:126,height:126,objectFit:'contain',opacity:entrance}}/>
   <div style={{position:'absolute',top:700,left:225,fontSize:38,fontWeight:650,opacity:entrance}}>onixus.xyz/book</div>
   <div style={{position:'absolute',top:1530,left:72,right:72,color:brand.accent,fontSize:31,fontWeight:600}}>Build. Grow. Automate.</div>
  </>}
  {!last&&<div style={{position:'absolute',left:72,bottom:345,fontSize:25,color:'#c5d0d5'}}>Illustrative business scenario</div>}
  <div style={{position:'absolute',left:72,right:72,bottom:300,display:'flex',gap:10}}>{Array.from({length:8},(_,i)=><div key={i} style={{height:4,flex:1,background:i<scene.idx?brand.accent:'rgba(255,255,255,.15)'}}>{i===scene.idx&&<div style={{height:'100%',width:`${progress*100}%`,background:brand.accent}}/>}</div>)}</div>
 </AbsoluteFill>;
}
export function TeamStory({scenes,brand,cta,fonts}){
 const {fps}=useVideoConfig();const opening=scenes.find(s=>s.imageSrc)?.imageSrc;
 return <AbsoluteFill>{scenes.map((scene,i)=>{const from=Math.round(scene.startMs*fps/1000),durationF=Math.max(1,Math.round((scene.endMs-scene.startMs)*fps/1000));return <Sequence key={scene.idx} from={from} durationInFrames={durationF}><StoryShot scene={scene} first={i===0} last={i===scenes.length-1} opening={opening} brand={brand} cta={cta} fonts={fonts} durationF={durationF}/></Sequence>;})}</AbsoluteFill>;
}
