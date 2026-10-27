import test from "node:test";
import assert from "node:assert/strict";
import { buildBeatStoryProps } from "./motion-render.js";

const payload = {
  scenes: [
    { idx: 2, start_ms: 3000, end_ms: 7000, on_screen_text: " Promise ", image_url: "https://x/p.jpg", image_path: "a/scene-02.jpg" },
    { idx: 1, start_ms: 0, end_ms: 3000, on_screen_text: "Hook", image_url: "https://x/h.jpg", image_path: "a/scene-01.jpg", beat: "hook" },
    { idx: 3, start_ms: 7000, end_ms: 12000, on_screen_text: "Value", image_url: "https://x/s.jpg", image_path: "a/scene-03-site-1.jpg" },
    { idx: 4, start_ms: 12000, end_ms: 15000, on_screen_text: "Book", image_url: null, endcard: true },
  ],
  plan: { scenes: [{ idx: 2, beat: "promise" }, { idx: 3, beat: "value_1+open_loop_1" }] },
  brand: { colors: ["#123456", "not-a-color", "#ABCDEF"], business_name: "RouteNorth", logo_url: "https://x/l.png" },
  cta: { text: "Book a call" },
  fonts: { heading: "Barlow Condensed" },
  eyebrow: "For trucking companies",
};

test("orders scenes and takes beats from the scene, then the plan, then CTA for the last", () => {
  const p = buildBeatStoryProps(payload);
  assert.deepEqual(p.scenes.map((s) => s.idx), [1, 2, 3, 4]);
  assert.deepEqual(p.scenes.map((s) => s.beat), ["hook", "promise", "value_1+open_loop_1", "cta"]);
  assert.equal(p.scenes[1].text, "Promise");
});

test("marks site captures and the end card", () => {
  const p = buildBeatStoryProps(payload);
  assert.deepEqual(p.scenes.map((s) => s.media), ["photo", "photo", "site", "endcard"]);
  assert.equal(buildBeatStoryProps({ scenes: [{ idx: 1, media: "site_screenshot", end_ms: 1000 }] }).scenes[0].media, "site");
});

test("length, brand colours and fonts", () => {
  const p = buildBeatStoryProps(payload, 1080, 1350);
  assert.equal(p.totalMs, 15000);
  assert.equal(p.height, 1350);
  assert.equal(p.brand.primary, "#123456");
  assert.equal(p.brand.accent, "#ABCDEF");
  assert.equal(p.fonts.heading, "Barlow Condensed");
  assert.equal(p.fonts.body, "Inter");
  assert.equal(p.cta, "Book a call");
});

test("empty payload still renders a valid one-second composition", () => {
  const p = buildBeatStoryProps({});
  assert.equal(p.totalMs, 1000);
  assert.equal(p.brand.primary, "#9254FF");
  assert.deepEqual(p.scenes, []);
});

test("reads Signal's { primary, secondary, accent } brand colours", () => {
  const p = buildBeatStoryProps({ brand: { colors: { primary: "#9254FF", secondary: "#0B1B33", accent: "#00CBE8" } } });
  assert.equal(p.brand.primary, "#9254FF");
  assert.equal(p.brand.accent, "#00CBE8");
});

test("The Rise: two CTA doors come from the plan", () => {
  const p = buildBeatStoryProps({ plan: { cta_doors: ["Book a free call", "  Join the free community ", "extra"] } });
  assert.deepEqual(p.ctaDoors, ["Book a free call", "Join the free community"]);
  assert.deepEqual(buildBeatStoryProps({}).ctaDoors, []);
});

test("The Rise beats keep their labels through to the template", () => {
  const p = buildBeatStoryProps({ scenes: [{ idx: 1, end_ms: 1000, beat: "mechanism+expectation" }, { idx: 2, end_ms: 2000, beat: "cta_two_door", endcard: true }] });
  assert.deepEqual(p.scenes.map((s) => s.beat), ["mechanism+expectation", "cta_two_door"]);
});

test("BeatStory matches the CTA by beat id, so 'expectation' is not an end card", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./motion/BeatStory.jsx", import.meta.url), "utf8");
  assert.match(src, /b\.split\("\+"\)\.some\(\(t\) => t === "cta" \|\| t\.startsWith\("cta_"\)\)/);
  assert.doesNotMatch(src, /b\.includes\("cta"\)/);
});

test("Real captures are labelled as the advertiser's work", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./motion/BeatStory.jsx", import.meta.url), "utf8");
  assert.match(src, /`Built by \$\{String\(name\)\.trim\(\)\}`/);
  assert.match(src, /siteLabel\(scene\.beat, brand\.businessName\)/);
});
