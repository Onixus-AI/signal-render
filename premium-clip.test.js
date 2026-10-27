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
