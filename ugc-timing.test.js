import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { retimeScenes, ugcStretchDurations } from "./ugc-timing.js";

test("a line longer than its scene lengthens the scene instead of failing", () => {
  // The Twin v2 failure: 6.5s of narration in a 4.3s scene.
  const out = ugcStretchDurations([5.3, 4.3, 5.3, 4], [5.0, 6.5, 4.1, NaN]);
  assert.equal(out[0], 5.3);
  assert.ok(Math.abs(out[1] - (6.5 / 1.1 + 0.2)) < 1e-9);
  assert.equal(out[2], 5.3);
  assert.equal(out[3], 4); // the end-card has no narration and keeps its time
});

test("a script far too long for the ad still fails, with the reason", () => {
  assert.throws(() => ugcStretchDurations([3, 3], [8, 8]), /shorten the script/);
});

test("scenes are re-timed back to back", () => {
  const s = retimeScenes([{ idx: 1 }, { idx: 2 }], [5.5, 4]);
  assert.deepEqual(s.map((x) => [x.start_ms, x.end_ms]), [[0, 5500], [5500, 9500]]);
});

test("the UGC branch stretches scenes and rebuilds captions before cutting", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /ugcStretchDurations\(durs, voSecs\)/);
  assert.match(source, /buildUgcAss\(retimed, width, height, /);
});


test('global narration is never allowed to exceed the content without fitting', async()=>{
  const {voiceoverFitPlan}=await import('./ugc-timing.js');
  const fitted=voiceoverFitPlan(33,30);assert.equal(fitted.adjust,true);assert.ok(fitted.tempo>1);assert.ok(33/fitted.tempo<30);
  assert.equal(voiceoverFitPlan(28,30).adjust,false);
  assert.throws(()=>voiceoverFitPlan(50,30),/shorten or regenerate/);
  assert.throws(()=>voiceoverFitPlan(10,30),/covers only/);
  assert.throws(()=>voiceoverFitPlan(30,0),/invalid/);
});

import { motionTimelineFit, MOTION_TAIL_SEC } from "./ugc-timing.js";

test("motion: the timeline grows to a long narration instead of speeding the voice", () => {
  const fit = motionTimelineFit(30, 37.5);
  assert.equal(fit.total, 37.5 + MOTION_TAIL_SEC);
  assert.ok(Math.abs(fit.scale - (37.5 + MOTION_TAIL_SEC) / 30) < 1e-9);
});

test("motion: the timeline shrinks to a short narration instead of slowing the voice", () => {
  const fit = motionTimelineFit(45, 34.7);
  assert.ok(Math.abs(fit.total - 35.9) < 1e-9);
  assert.ok(fit.scale < 1);
});

test("motion: a near fit keeps the planned timeline", () => {
  assert.deepEqual(motionTimelineFit(30, 28.5), { scale: 1, total: 30 });
});

test("motion: bounds", () => {
  assert.equal(motionTimelineFit(30, 4).total, 10);
  assert.throws(() => motionTimelineFit(30, 90), /longer than a 75s ad/);
  assert.throws(() => motionTimelineFit(30, 0), /invalid/);
});
