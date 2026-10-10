import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SCREENSHOT_HOSTS,
  allowedCaptureUrl,
  captureOptions,
  focusTokens,
  looksLikeBotChallenge,
  pickFocusOffset,
  scoreHeading,
  parseAllowedHosts,
} from "./site-capture.js";

const hosts = DEFAULT_SCREENSHOT_HOSTS;

test("allowlist accepts only https pages on exact allowed hosts", () => {
  assert.equal(allowedCaptureUrl("https://onixus.xyz/pricing", hosts), "https://onixus.xyz/pricing");
  assert.equal(allowedCaptureUrl("https://www.onixus.xyz", hosts), "https://www.onixus.xyz/");
  assert.equal(allowedCaptureUrl("http://onixus.xyz", hosts), null);
  assert.equal(allowedCaptureUrl("https://onixus.xyz.evil.com", hosts), null);
  assert.equal(allowedCaptureUrl("https://evilonixus.xyz", hosts), null);
  assert.equal(allowedCaptureUrl("https://user:pw@onixus.xyz", hosts), null);
  assert.equal(allowedCaptureUrl("https://onixus.xyz:8443", hosts), null);
  assert.equal(allowedCaptureUrl("https://169.254.169.254/latest/meta-data", hosts), null);
  assert.equal(allowedCaptureUrl("file:///etc/passwd", hosts), null);
  assert.equal(allowedCaptureUrl("not a url", hosts), null);
});

test("allowed hosts come from env with a safe default", () => {
  assert.deepEqual(parseAllowedHosts(""), DEFAULT_SCREENSHOT_HOSTS);
  assert.deepEqual(parseAllowedHosts(" A.com, b.com ,"), ["a.com", "b.com"]);
});

test("capture defaults to a 1080x1920 phone frame and clamps input", () => {
  const d = captureOptions({});
  assert.deepEqual([d.width, d.height, d.deviceScale, d.scrollY, d.mobile, d.type], [540, 960, 2, 0, true, "png"]);
  const c = captureOptions({ width: 99999, height: 1, device_scale: 9, scroll_y: -5, format: "jpg", mobile: false });
  assert.deepEqual([c.width, c.height, c.deviceScale, c.scrollY, c.mobile, c.type], [1920, 320, 3, 0, false, "jpeg"]);
});

test("server enforces the allowlist on every navigation", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /app\.post\("\/screenshot-url", auth,/);
  assert.match(source, /isNavigationRequest\(\)/);
  assert.match(source, /allowedCaptureUrl\(page\.url\(\), SCREENSHOT_HOSTS\)/);
});

test("bot-check interstitials are detected, real pages are not", () => {
  assert.equal(looksLikeBotChallenge("Just a moment...", ""), true);
  assert.equal(looksLikeBotChallenge("npm", "This page is displayed while the website verifies you are not a bot. security verification"), true);
  assert.equal(looksLikeBotChallenge("Onixus | AI Venture Studio", "We build, we grow, we automate. Executive, Manager and Worker bots."), false);
});

test("strip capture options are clamped", () => {
  assert.equal(captureOptions({}).stripScreens, 1);
  assert.equal(captureOptions({ strip_screens: 9 }).stripScreens, 4);
  assert.equal(captureOptions({ focus_text: "x".repeat(900) }).focusText.length, 300);
});

test("the strip starts at the heading that matches the spoken line", () => {
  const headings = [
    { text: "Build, grow, automate", top: 0 },
    { text: "Autopilot captures leads and follows up", top: 1800 },
    { text: "How it works", top: 3400 },
  ];
  const line = "This is Autopilot. It captures leads, sends outreach and follows up.";
  assert.deepEqual(pickFocusOffset(headings, line, 0), { y: 1720, match: "Autopilot captures leads and follows up" });
  assert.deepEqual(pickFocusOffset(headings, "We delete the wasted steps first", 960), { y: 960, match: null });
  assert.equal(scoreHeading("Follow-up that never sleeps", focusTokens("follows up on leads")), 1);
  assert.ok(!focusTokens("This is what you want").length);
});

test("site captures render as a phone-framed scroll in UGC ads", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /async function siteScrollClip\(/);
  assert.match(source, /else if \(s\.site_capture && !s\.videoFile\)/);
  assert.match(source, /captureBeyondViewport: true/);
});
