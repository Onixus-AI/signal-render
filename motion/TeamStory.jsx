import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'};
function StoryShot({scene,first,last,opening,brand,cta,fonts,durationF}){
 const frame=useCurrentFrame();
 const entrance=interpolate(frame,[0,12],[0,1],{...clamp,easing:Easing.out(Easing.cubic)});
 const progress=interpolate(frame,[0,durationF],[0,1],clamp);
 const action=scene.characterAction;
 const left=action==='handoff'?interpolate(progress,[0,.65],[80,590],clamp):action==='question'?60:580;
 const tilt=action==='question'?Math.sin(frame/18)*5:0;
 const image=last?opening:scene.imageSrc;
 return <AbsoluteFill style={{background:'#101416',color:'#fff',fontFamily:fonts.bodyStack}}>
  {image&&<AbsoluteFill style={{overflow:'hidden',opacity:last ? .23 : 1}}><Img src={image} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${1.02+progress*.045})`}}/></AbsoluteFill>}
  <AbsoluteFill style={{background:last?'transparent':'linear-gradient(180deg,rgba(0,0,0,.55),transparent 48%,rgba(0,0,0,.78))'}}/>
  <div style={{position:'absolute',top:150,left:72,right:72,display:'flex',alignItems:'center',gap:20}}>
   <Img src={brand.logoUrl} style={{width:88,height:88,objectFit:'contain'}}/>
   <span style={{fontFamily:fonts.headingStack,fontSize:32,fontWeight:650}}>Onixus</span>
  </div>
  {last?<>
   <Img src={brand.logoUrl} style={{position:'absolute',top:390,left:340,width:400,height:400,objectFit:'contain',opacity:entrance}}/>
   <div style={{position:'absolute',top:860,left:90,right:90,fontFamily:fonts.headingStack,fontSize:78,lineHeight:1.08,fontWeight:750,textAlign:'center',opacity:entrance}}>{cta||scene.text}</div>
   <div style={{position:'absolute',top:1190,left:90,right:90,fontSize:34,textAlign:'center',color:'#fff'}}>onixus.xyz</div>
   <Img src={scene.characterSrc} style={{position:'absolute',top:1280,left:690,width:250,height:320,objectFit:'contain',opacity:entrance}}/>
  </>:<>
   <div style={{position:'absolute',top:first?350:300,left:72,right:110,fontFamily:fonts.headingStack,fontSize:Math.min(98,scene.text.length>55?72:90),lineHeight:1.04,fontWeight:750,letterSpacing:'-.035em',textShadow:'0 3px 30px #000',opacity:entrance}}>{scene.text}</div>
   {!first&&scene.characterSrc&&<Img src={scene.characterSrc} style={{position:'absolute',left,top:840,width:420,height:570,objectFit:'contain',transform:`translateY(${(1-entrance)*80}) rotate(${tilt}deg)`,opacity:entrance}}/>}
   {scene.partnerSrc&&<Img src={scene.partnerSrc} style={{position:'absolute',left:left>300?65:590,top:900,width:370,height:500,objectFit:'contain',opacity:entrance}}/>}
   <div style={{position:'absolute',left:72,bottom:330,fontSize:27,color:'#fff',padding:'12px 18px',background:'rgba(0,0,0,.65)'}}>Illustrative business scenario</div>
  </>}
  <div style={{position:'absolute',left:72,right:72,bottom:290,height:3,background:'rgba(255,255,255,.2)'}}><div style={{height:'100%',width:`${progress*100}%`,background:brand.accent}}/></div>
 </AbsoluteFill>;
}
export function TeamStory({scenes,brand,cta,fonts}){
 const {fps}=useVideoConfig();const opening=scenes.find(s=>s.imageSrc)?.imageSrc;
 return <AbsoluteFill>{scenes.map((scene,i)=>{const from=Math.round(scene.startMs*fps/1000),durationF=Math.max(1,Math.round((scene.endMs-scene.startMs)*fps/1000));return <Sequence key={scene.idx} from={from} durationInFrames={durationF}><StoryShot scene={scene} first={i===0} last={i===scenes.length-1} opening={opening} brand={brand} cta={cta} fonts={fonts} durationF={durationF}/></Sequence>;})}</AbsoluteFill>;
}
