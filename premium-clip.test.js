import test from "node:test";
import assert from "node:assert/strict";
import { isSiteCapture, premiumClipStretch } from "./premium-clip.js";
import { googleFontCssUrl, ttfUrlFromCss, subtitlesFilter } from "./caption-font.js";

test("site captures are recognised by media or file name", () => {
  assert.equal(isSiteCapture({ media: "site_screenshot" }), true);
  assert.equal(isSiteCapture({ image_path: "a/b/scenes/scene-03-site-1793143007450.jpg" }), true);
  assert.equal(isSiteCapture({ image_path: "a/b/scenes/scene-02-1793142998160.jpg" }), false);
});

test("clips slow at most 1.3x and never speed up", () => {
  assert.equal(premiumClipStretch(5, 4), 1);
  assert.equal(premiumClipStretch(4, 4.8), 1.2);
  assert.equal(premiumClipStretch(4, 10), 1.3);
  assert.equal(premiumClipStretch(0, 4), 1);
});

test("Google font CSS parsing finds the TrueType file", () => {
  assert.equal(googleFontCssUrl("Barlow Condensed"), "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800");
  const css = "@font-face { font-family: 'Outfit'; src: url(https://fonts.gstatic.com/s/outfit/v11/abc.ttf) format('truetype'); }";
  assert.equal(ttfUrlFromCss(css), "https://fonts.gstatic.com/s/outfit/v11/abc.ttf");
  assert.equal(ttfUrlFromCss("src: url(https://fonts.gstatic.com/s/x.woff2)"), null);
  assert.equal(subtitlesFilter("/nonexistent/captions.ass"), "subtitles=/nonexistent/captions.ass");
});

import { buildCinematicProps } from "./motion-render.js";
test("cinematic props: clips by scene, site captures, end card, full lockup", () => {
  const scenes = [
    { idx: 1, start_ms: 0, end_ms: 4000, on_screen_text: "Hook", image_url: "https://x/a.jpg" },
    { idx: 2, start_ms: 4000, end_ms: 9000, on_screen_text: "Site", image_url: "https://x/b.jpg", image_path: "c/p/scenes/scene-02-site-1.jpg" },
    { idx: 3, start_ms: 9000, end_ms: 12000, on_screen_text: "Book a call", image_url: "https://x/c.png", endcard: true },
  ];
  const props = buildCinematicProps({ brand: { business_name: "Onixus", colors: { primary: "#9254FF", accent: "#00CBE8", secondary: "#E625A5" }, lockup_url: "https://x/lockup.png" } }, scenes, ["http://127.0.0.1/c0.mp4", null, null]);
  assert.deepEqual(props.scenes.map((s) => s.media), ["photo", "site", "endcard"]);
  assert.equal(props.scenes[0].videoSrc, "http://127.0.0.1/c0.mp4");
  assert.equal(props.scenes[1].videoSrc, null);
  assert.equal(props.brand.lockupUrl, "https://x/lockup.png");
  assert.equal(props.brand.magenta, "#E625A5");
});
