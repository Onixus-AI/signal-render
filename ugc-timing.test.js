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
