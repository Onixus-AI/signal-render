// Where the ad's star (Onyx) stands in each layout, on the 1080x1920 canvas,
// and where his speech sticker goes. Kept apart from Star.jsx so the geometry
// can be tested without a renderer.
//
// 2026-11-01: on hook and open-loop beats Onyx (and his "!!"/"..."/"Easy."
// sticker) landed on the headline: "single-p!!ge", "KEEP WATCHIN". Text
// layouts that start at y=640 (hook without a photo, open loop) run to about
// y=1180, so a star sharing a beat with text stands below TEXT_BAND_BOTTOM.
export const CANVAS = { width: 1080, height: 1920 };
export const TEXT_BAND_BOTTOM = 1200;

export const SPOTS = {
  hook: { x: 760, y: 1500, size: 520 },        // below the headline (no photo)
  hook_photo: { x: 850, y: 1020, size: 380 },  // over the photo's lower-right corner
  promise: { x: 860, y: 690, size: 340 },
  value: { x: 880, y: 1640, size: 320 },
  graphic: { x: 900, y: 1700, size: 300 },
  loop: { x: 540, y: 1520, size: 560 },
  cta: { x: 230, y: 1690, size: 300 },
  solo: { x: 540, y: 1520, size: 600 },        // carries the beat, still clear of its text
};

export function spotFor(layout) {
  return SPOTS[layout] || SPOTS.value;
}

/** Top-left of the speech sticker: beside the star's head, never above it. */
export function bubbleOrigin(layout, spot) {
  const x = layout === "solo" || layout === "loop" ? spot.x + spot.size * 0.18
    : spot.x > 700 ? spot.x - spot.size * 0.75
    : spot.x + spot.size * 0.25;
  return { x, y: spot.y - spot.size * 0.48 };
}

/** The star's box (before animation offsets). */
export function starBox(spot) {
  return { left: spot.x - spot.size / 2, top: spot.y - spot.size / 2, right: spot.x + spot.size / 2, bottom: spot.y + spot.size / 2 };
}
