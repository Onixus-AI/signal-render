import test from "node:test";
import assert from "node:assert/strict";
import { CANVAS, SPOTS, TEXT_BAND_BOTTOM, bubbleOrigin, spotFor, starBox } from "./motion/star-spots.js";

// 2026-11-01 render sheets: Onyx and his sticker sat on the headline on hook
// and open-loop beats ("single-p!!ge", "KEEP WATCHIN"). Layouts that share the
// beat with a top text block must keep the star and sticker below it.
const SHARES_BEAT_WITH_TEXT = ["hook", "loop", "solo"];

for (const layout of SHARES_BEAT_WITH_TEXT) {
  test(`${layout}: star stands below the text band`, () => {
    assert.ok(starBox(spotFor(layout)).top >= TEXT_BAND_BOTTOM, `${layout} star top ${starBox(spotFor(layout)).top}`);
  });
  test(`${layout}: sticker sits below the text band`, () => {
    assert.ok(bubbleOrigin(layout, spotFor(layout)).y >= TEXT_BAND_BOTTOM, `${layout} sticker y ${bubbleOrigin(layout, spotFor(layout)).y}`);
  });
}

test("every star stays on the canvas", () => {
  for (const [layout, spot] of Object.entries(SPOTS)) {
    const b = starBox(spot);
    assert.ok(b.left >= 0 && b.right <= CANVAS.width && b.top >= 0 && b.bottom <= CANVAS.height, `${layout} off canvas`);
  }
});

test("a hook with a photo keeps the corner spot", () => {
  assert.deepEqual(spotFor("hook_photo"), { x: 850, y: 1020, size: 380 });
});

test("unknown layouts fall back to the value spot", () => {
  assert.equal(spotFor("nope"), SPOTS.value);
});
