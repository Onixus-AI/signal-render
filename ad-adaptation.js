export const AD_CANVASES={'9:16':[1080,1920],'4:5':[1080,1350],'1:1':[1080,1080],'16:9':[1920,1080]};
export function adaptationFilter(format){
 const dims=AD_CANVASES[format];if(!dims)throw new Error('Unsupported ad canvas');
 const [w,h]=dims;const iw=Math.floor(w*0.88/2)*2,ih=Math.floor(h*(format==='9:16'?0.72:0.88)/2)*2;
 return `scale=${iw}:${ih}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x10131b,setsar=1,format=yuv420p`;
}
export function adaptationArgs(source,out,format){return ['-y','-i',source,'-map','0:v:0','-map','0:a?','-vf',adaptationFilter(format),'-c:v','libx264','-preset','fast','-crf','18','-c:a','copy','-movflags','+faststart',out];}
export function adaptationUrl(value,base,upload=false){
 const url=new URL(value),origin=new URL(base);
 const prefix=upload?'/storage/v1/object/upload/sign/signal-video/':'/storage/v1/object/sign/signal-video/';
 if(url.protocol!=='https:'||url.origin!==origin.origin||!url.pathname.startsWith(prefix)||url.username||url.password)throw new Error('Invalid signed adaptation URL');
 return url.href;
}
