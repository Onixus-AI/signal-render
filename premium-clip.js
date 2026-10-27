// Premium (AI-motion) cinematic helpers.

/** A scene whose picture is a real capture of a site Signal built. */
export function isSiteCapture(s) {
  return s?.media === "site_screenshot" || /-site-\d+\.(jpe?g|png)$/i.test(String(s?.image_path || ""));
}

/**
 * How much slower to play a generated clip so it covers its scene: never
 * faster than made, at most 1.3x slower (beyond that motion looks broken, so
 * the last frame holds instead).
 */
export function premiumClipStretch(srcSec, needSec) {
  if (!(srcSec > 0) || !(needSec > 0)) return 1;
  return Math.min(1.3, Math.max(1, needSec / srcSec));
}
