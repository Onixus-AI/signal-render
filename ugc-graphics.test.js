import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assColor, buildGraphicAss, graphicVariant, lowerThirdEvents, normalizeGraphic, wrapLines } from "./ugc-graphics.js";

test("brand colours convert to ASS override colours, with a safe fallback", () => {
  assert.equal(assColor("#7C3AED"), "&HED3A7C&");
  assert.equal(assColor("nope"), "&HF6A33B&");
});

test("a graphic keeps to what reads in a few seconds", () => {
  const g = normalizeGraphic({ headline: "one two three four five six seven eight", points: ["a", "b", "c", "d", ""] });
  assert.equal(g.headline.split(" ").length, 7);
  assert.equal(g.points.length, 3);
  assert.equal(normalizeGraphic({ headline: "  " }), null);
  assert.equal(normalizeGraphic({ headline: "Say {\\b1}hi" }).headline, "Say b1hi");
});

test("headline wraps by line length, never mid-word", () => {
  assert.deepEqual(wrapLines("Your business runs while you sleep", 14), ["Your business", "runs while you", "sleep"]);
});

test("three layouts rotate by scene, each animating the headline and points", () => {
  const g = { headline: "Runs while you sleep", points: ["Captures every lead", "Follows up fast"] };
  const kinetic = buildGraphicAss(g, 4000, 1080, 1920, { accent: "#7C3AED" }, 0);
  const highlight = buildGraphicAss(g, 4000, 1080, 1920, { accent: "#7C3AED" }, 1);
  const chips = buildGraphicAss(g, 4000, 1080, 1920, { accent: "#7C3AED" }, 2);
  for (const ass of [kinetic, highlight, chips]) {
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /&HED3A7C&/);
    assert.equal((ass.match(/,Gfx,/g) || []).length, 2); // drifting glows
  }
  assert.match(kinetic, /\\t\(\d+,\d+,\\alpha&H00&\)/); // word-by-word reveal
  assert.equal((kinetic.match(/,Point,/g) || []).length, 2);
  assert.ok((highlight.match(/,Mark,/g) || []).length >= 1); // marker wipe
  assert.match(highlight, /\\t\(0,320,\\clip/);
  assert.equal((highlight.match(/,PointL,/g) || []).length, 2);
  assert.equal((chips.match(/,Chip,/g) || []).length, 2);
  assert.notEqual(graphicVariant(3), graphicVariant(4));
  assert.equal(buildGraphicAss({ headline: "" }, 4000, 1080, 1920), null);
});

test("points that would start after the beat ends are dropped", () => {
  const ass = buildGraphicAss({ headline: "Fast", points: ["one", "two", "three"] }, 1400, 1080, 1920, {}, 2);
  assert.equal((ass.match(/,Chip,/g) || []).length, 1);
});

test("the name tag slides in on the first beat and needs a name", () => {
  assert.equal(lowerThirdEvents({ name: "Omar Harris", title: "Founder, Onixus" }, 0, 5000, 1080, 1920).length, 2);
  assert.deepEqual(lowerThirdEvents({ title: "x" }, 0, 5000, 1080, 1920), []);
  assert.deepEqual(lowerThirdEvents({ name: "Omar" }, 0, 900, 1080, 1920), []);
});

test("UGC assembly renders graphic beats and keeps their words off the caption track", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /else if \(s\.graphic && !s\.videoFile\)/);
  assert.match(source, /if \(s\.graphic \|\| !captions\) continue;/);
  assert.match(source, /lowerThirdEvents\(s\.lower_third/);
});

test("long points wrap instead of running off a portrait frame", () => {
  const ass = buildGraphicAss({ headline: "Fast", points: ["Captures every single inbound lead automatically"] }, 4000, 1080, 1920, {}, 0);
  const point = ass.split("\n").find((l) => l.includes(",Point,"));
  assert.match(point, /\\N/);
});

test("name tags are written even when captions are off", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /const wantTags = isUgc && sorted\.some\(\(s\) => s\.lower_third\)/);
  assert.match(source, /if \(s\.graphic \|\| !captions\) continue;/);
});

test("a full graphic shrinks to fit the frame instead of running off the bottom", () => {
  const g = { headline: "Your entire business runs while you sleep tonight", points: ["Captures every single inbound lead", "Follows up in minutes every time", "Books the call without you"] };
  for (const [w, h] of [[1080, 1920], [1080, 1080], [1920, 1080]]) {
    for (const seed of [0, 1, 2]) {
      const ass = buildGraphicAss(g, 6000, w, h, {}, seed);
      const pts = [...ass.matchAll(/,(?:Point|PointL|Chip),[^\n]*?(?:\\pos\(|\\move\()-?\d+,(\d+)/g)].map((m) => Number(m[1]));
      assert.equal(pts.length, 3);
      for (const y of pts) assert.ok(y < h * 0.95, `${w}x${h} seed ${seed}: point at y=${y}`);
    }
  }
});

