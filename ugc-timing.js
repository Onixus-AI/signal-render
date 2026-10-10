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
