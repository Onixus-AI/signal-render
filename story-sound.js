/** Original synthesized accents, mixed quietly under the narration/music bed. */
export function addStorySound(graph,baseLabel,scenes,total){
 const notification=Math.max(0,Math.min(total-0.2,Number(scenes?.[0]?.end_ms??3500)/1000-0.2));
 const handoff=Math.max(0,Math.min(total-0.2,Number(scenes?.find(s=>s.character_action==='handoff')?.start_ms??13500)/1000));
 for(const [name,frequency,time] of [['notification',880,notification],['handoff',660,handoff]])graph.push(`sine=frequency=${frequency}:duration=0.16:sample_rate=48000,volume=0.12,afade=t=out:st=0.04:d=0.12,adelay=${Math.round(time*1000)}:all=1[${name}]`);
 graph.push(`[${baseLabel}][notification][handoff]amix=inputs=3:duration=first:normalize=0[storysound]`);
 return 'storysound';
}
