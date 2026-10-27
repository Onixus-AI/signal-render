// UGC scene timing against the narration that was actually synthesized.
//
// The coordinator plans scene lengths from a words-per-second estimate, but
// the real voice is often slower (lists and commas add pauses): the first
// Twin v2 render failed because a 14-word line ran 6.5s in a 4.3s scene.
// Talking heads are generated from the narration audio, so the clip already
// lasts as long as the line. The scene should too, rather than failing.

/** Sum of an array of seconds. */
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * Lengthen any scene whose narration does not fit, so the line plays at no
 * more than `tempo` speed plus a short breath. Scenes never shrink. If the
 * whole ad would grow by more than `maxGrowth`, the script itself is too
 * long and the job fails with that reason.
 */
export function ugcStretchDurations(durs, voSecs, { tempo = 1.1, pad = 0.2, maxGrowth = 1.5 } = {}) {
  const out = durs.map((d, i) => {
    const vo = Number(voSecs?.[i]);
    if (!Number.isFinite(vo) || vo <= 0) return d;
    return Math.max(d, vo / tempo + pad);
  });
  const before = sum(durs);
  const after = sum(out);
  if (after > before * maxGrowth) {
    throw new Error(`narration needs ${after.toFixed(1)}s against a ${before.toFixed(1)}s ad — shorten the script`);
  }
  return out;
}

/** Re-time scenes back to back from the new durations (ms, from zero). */
export function retimeScenes(scenes, durs) {
  let t = 0;
  return scenes.map((s, i) => {
    const start = Math.round(t * 1000);
    t += durs[i];
    return { ...s, start_ms: start, end_ms: Math.round(t * 1000) };
  });
}


/** Keep full narration within the timeline; large mismatches require a new script. */
export function voiceoverFitPlan(originalSec, totalSec) {
  if (!Number.isFinite(originalSec) || originalSec <= 0 || !Number.isFinite(totalSec) || totalSec <= 0) throw new Error('voiceover duration is invalid');
  const coverage = originalSec / totalSec;
  if (coverage < 0.55) throw new Error(`narration covers only ${Math.round(coverage * 100)}% of the video; regenerate the script before publishing`);
  if (coverage >= 0.9 && coverage <= 1) return {coverage,adjust:false,tempo:1};
  const tempo = originalSec / (totalSec * (coverage > 1 ? 0.98 : 0.96));
  if (tempo < 0.5 || tempo > 1.2) throw new Error('narration cannot fit without excessive pacing correction; shorten or regenerate the script');
  return {coverage,adjust:true,tempo};
}


/**
 * Motion ads (Remotion BeatStory): the timeline follows the narration, never
 * the other way round. Speeding a voice up or slowing it to 77% to fill a
 * fixed slot is what made earlier ads sound rushed or sluggish. The narration
 * plays at its natural pace and the end card gets a short tail.
 */
export const MOTION_TAIL_SEC = 1.2;
export function motionTimelineFit(timelineSec, voiceSec, { minSec = 10, maxSec = 75 } = {}) {
  if (!Number.isFinite(timelineSec) || timelineSec <= 0 || !Number.isFinite(voiceSec) || voiceSec <= 0) throw new Error('voiceover duration is invalid');
  const total = Math.min(maxSec, Math.max(minSec, voiceSec + MOTION_TAIL_SEC));
  if (voiceSec > maxSec) throw new Error(`narration runs ${voiceSec.toFixed(1)}s, longer than a ${maxSec}s ad; shorten the script`);
  const scale = total / timelineSec;
  return Math.abs(scale - 1) < 0.03 ? { scale: 1, total: timelineSec } : { scale, total };
}

/**
 * Motion ads with one recording per scene: each scene lasts exactly as long
 * as its own line, so the picture changes when the voice moves on (Omar,
 * Oct 27: "not 5 seconds later"). The line starts LEAD seconds into its scene
 * (the picture lands first, by a hair) and a short breath follows it. A scene
 * with no line keeps its planned length; the end card always gets room to read.
 */
export const MOTION_LINE_LEAD_SEC = 0.12;
export const MOTION_LINE_GAP_SEC = 0.3;
export function motionSceneDurations(lineSecs, plannedSecs, { endcardMinSec = 2.5, endcardTailSec = 1.2 } = {}) {
  const n = plannedSecs.length;
  return plannedSecs.map((planned, i) => {
    const line = Number(lineSecs[i]) || 0;
    const last = i === n - 1;
    if (line <= 0) return last ? Math.max(planned, endcardMinSec) : Math.max(1.2, planned);
    const d = MOTION_LINE_LEAD_SEC + line + (last ? endcardTailSec : MOTION_LINE_GAP_SEC);
    return last ? Math.max(d, endcardMinSec) : d;
  });
}
