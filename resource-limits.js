export const VIDEO_LIMITS={maxScenes:60,maxDurationMs:600000,maxAssetBytes:120*1024*1024,maxTotalAssetBytes:500*1024*1024,maxPending:50};
export function videoResourceError(p){
 if(p.scenes?.length>VIDEO_LIMITS.maxScenes)return 'too many scenes (max 60)';
 if(!Array.isArray(p.scenes)||p.scenes.length===0)return 'at least one scene is required';
 let total=0;
 for(const s of p.scenes){if(!Number.isFinite(s.start_ms)||!Number.isFinite(s.end_ms)||s.start_ms<0||s.end_ms<=s.start_ms)return 'invalid scene timing';total+=s.end_ms-s.start_ms;if(s.end_ms>VIDEO_LIMITS.maxDurationMs)return 'video timeline exceeds 10 minutes';}
 if(total>VIDEO_LIMITS.maxDurationMs)return 'total scene duration exceeds 10 minutes';
 return null;
}
export async function boundedBytes(response,budget,maxBytes=VIDEO_LIMITS.maxAssetBytes){
 const declared=Number(response.headers.get('content-length'));
 if(declared>maxBytes||budget.bytes+declared>VIDEO_LIMITS.maxTotalAssetBytes){await response.body?.cancel().catch(()=>{});throw Error('Asset size limit exceeded');}
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;budget.bytes+=value.byteLength;
  if(size>maxBytes||budget.bytes>VIDEO_LIMITS.maxTotalAssetBytes){await reader.cancel().catch(()=>{});throw Error('Asset size limit exceeded');}chunks.push(Buffer.from(value));}
 }finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
