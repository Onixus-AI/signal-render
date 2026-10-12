import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { normalizeGraphic } from "./ugc-graphics.js";
import { COMMAND_LOGO, commandBeatJsx, commandBeatLayout, commandBeatTiming, renderCommandBeat } from "./effectcraft.js";

const G = { headline: "Your follow-ups run themselves now", points: ["Leads answered in minutes", "Invoices chased automatically", "Every job logged"] };

test("the Command logo asset ships with the worker", () => {
  assert.ok(existsSync(COMMAND_LOGO));
});

for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
  test(`layout fits the safe area at ${w}x${h}`, () => {
    const L = commandBeatLayout(G, w, h);
    assert.ok(L, "layout");
    assert.ok(L.lines.length >= 1 && L.lines.length <= 3);
    assert.equal(L.points.length, 3);
    const top = L.logo.cy - (518 * L.logo.scale) / 2;
    const bottom = L.points.at(-1).y + L.ps * 0.4;
    assert.ok(top >= h * 0.1 - 1, `top ${top}`);
    assert.ok(bottom <= h * 0.88 + 1, `bottom ${bottom}`);
    for (let i = 1; i < L.lines.length; i++) assert.ok(L.lines[i].y > L.lines[i - 1].y);
    assert.ok(L.points[0].y > L.lines.at(-1).y);
  });
}

test("no headline means no beat", () => {
  assert.equal(commandBeatLayout({ headline: "", points: ["x"] }, 1080, 1920), null);
  assert.equal(commandBeatJsx({ points: ["x"] }, { w: 1080, h: 1920, durSec: 3 }), null);
});

test("timing lands every point before the beat ends", () => {
  for (const d of [1.8, 2.5, 3.5, 6]) {
    const T = commandBeatTiming(d, 3);
    assert.ok(T.pointsStart + 2 * T.stagger + 0.5 <= T.d + 0.05, `d=${d}`);
    assert.ok(T.glint + 0.6 <= T.d);
  }
});

test("the generated script is valid JavaScript and carries the words as data", () => {
  const evil = { headline: 'Quote " and \\ and </script> stay text', points: ["a\nb"] };
  const jsx = commandBeatJsx(evil, { w: 1080, h: 1920, durSec: 3.5 });
  assert.ok(jsx);
  assert.doesNotThrow(() => new Function(jsx));
  const D = JSON.parse(/var D = (.*);\n/.exec(jsx)[1]);
  assert.equal(D.L.lines.map((l) => l.text).join(" "), normalizeGraphic(evil).headline);
  assert.match(D.L.lines.map((l) => l.text).join(" "), /Quote " and .*<\/script>/);
  assert.equal(D.w, 1080);
  assert.ok(D.logoPath.endsWith("command-logo.png"));
});

test("without the CLI the beat reports failure instead of throwing", async () => {
  const r = await renderCommandBeat(G, "/tmp/never.mp4", { w: 1080, h: 1920, durSec: 3, dir: "/tmp", bin: null });
  assert.deepEqual(r, { ok: false, error: "effectcraft-cli not installed" });
});
