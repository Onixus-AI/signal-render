export const AD_CANVASES={'9:16':[1080,1920],'4:5':[1080,1350],'1:1':[1080,1080],'16:9':[1920,1080]};
// Fit the whole master inside the platform canvas (nothing cropped: captions,
// name tags and the brand mark all survive) and fill the spare edges with a
// blurred, darkened copy of the same frames instead of flat bars. When the
// master already has the canvas's shape it fills the frame exactly. The blur
// runs at quarter size, so it costs little on the worker's CPU.
export function adaptationFilter(format){
 const dims=AD_CANVASES[format];if(!dims)throw new Error('Unsupported ad canvas');
 const [w,h]=dims;const bw=Math.round(w/8)*2,bh=Math.round(h/8)*2;
 return `split=2[bg][fg];[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=12,scale=${w}:${h},eq=brightness=-0.16:saturation=0.85[b];`+
  `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p`;
}
export function adaptationArgs(source,out,format){return ['-y','-i',source,'-map','0:v:0','-map','0:a?','-vf',adaptationFilter(format),'-c:v','libx264','-preset','fast','-crf','18','-c:a','copy','-movflags','+faststart',out];}
export function adaptationUrl(value,base,upload=false){
 const url=new URL(value),origin=new URL(base);
 const prefix=upload?'/storage/v1/object/upload/sign/signal-video/':'/storage/v1/object/sign/signal-video/';
 if(url.protocol!=='https:'||url.origin!==origin.origin||!url.pathname.startsWith(prefix)||url.username||url.password)throw new Error('Invalid signed adaptation URL');
 return url.href;
}
