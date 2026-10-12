// Motion-graphic beats rendered by EffectCraft (storytold/effectcraft, MIT OR
// Apache-2.0): an After Effects-style compositor with a headless CLI. The worker
// writes an ExtendScript-compatible .jsx per beat, lets `effectcraft-cli script`
// build the comp, then `effectcraft-cli render` writes a silent MP4 that the
// caller muxes with the narration. Any failure returns false and the caller
// falls back to the libass graphic, so a bad EffectCraft build never costs a
// day's ad.
//
// The design: the Onixus mark pops in with a small overshoot (every ad builds
// recognition of the one brand), a light glint crosses it and the ONIXUS
// wordmark settles under it; then the headline rises in line by line and the
// points slide in behind chevron bullets in the mark's colours. Colour lives
// only in the mark; type is solid white on near-black (open-design-intelligence:
// no gradient text, no neon/glass defaults).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGraphic } from "./ugc-graphics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BRAND_MARK = join(HERE, "mograph", "onixus-mark.png");
// The cropped Onixus mark (from radiant-connect-dash public/onixus_logo_tiktok_1024.png).
export const LOGO_SIZE = [624, 720];
// Colours sampled from the mark: cyan, blue, purple.
export const MARK_COLORS = ["#25A5DE", "#4F8BEA", "#7E3BD5"];

export function effectcraftCli(env = process.env) {
  const p = env.EFFECTCRAFT_CLI || "/opt/effectcraft/bin/effectcraft-cli";
  return existsSync(p) ? p : null;
}

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => +v.toFixed(4));
};

// Split words into n lines with the longest line as short as possible, so a
// headline never ends on a lone word ("…run themselves / now").
export function balancedLines(text, n) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (n <= 1 || words.length <= 1) return [words.join(" ")];
  let best = null;
  const walk = (start, left, acc) => {
    if (left === 1) {
      const lines = [...acc, words.slice(start).join(" ")];
      const worst = Math.max(...lines.map((l) => l.length));
      if (!best || worst < best.worst) best = { lines, worst };
      return;
    }
    for (let end = start + 1; end <= words.length - left + 1; end++) walk(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
  };
  walk(0, Math.min(n, words.length), []);
  return best.lines;
}

// Fewest balanced lines that fit maxChars, or null when even 3 do not.
function fitHeadline(text, maxChars) {
  for (let n = 1; n <= 3; n++) {
    const lines = balancedLines(text, n);
    if (Math.max(...lines.map((l) => l.length)) <= maxChars) return lines;
  }
  return null;
}

// Average advance of the bundled Inter faces, measured on CI renders.
const HEAD_CHAR = 0.52, POINT_CHAR = 0.56;

// Lay the beat out in pixels: logo block, headline lines, point rows, all
// stacked and centred in the frame's safe area. Type shrinks until every
// word fits; nothing is ever cut.
export function brandBeatLayout(graphic, w, h) {
  const g = normalizeGraphic(graphic);
  if (!g) return null;
  const u = Math.min(w, h) / 1080;
  const safeTop = h * 0.1, safeH = h * 0.78;
  // Portrait has room to spare: a bigger mark and type fill the frame.
  const tall = h > w * 1.2;
  for (let k = 1; k >= 0.45; k -= 0.05) {
    const markH = Math.round((tall ? 580 : 320) * u * k);
    const hs = Math.round((tall ? 104 : 92) * u * k);
    const ws = Math.round(hs * 0.42);
    // The block above the headline: the mark, then the ONIXUS wordmark.
    const logoH = markH + Math.round(ws * 2.2);
    const lines = fitHeadline(g.headline, Math.floor((w * 0.86) / (hs * HEAD_CHAR)));
    const ps = Math.round(hs * 0.56);
    const pMax = Math.floor((w * 0.84 - ps * 0.7) / (ps * POINT_CHAR));
    if (!lines || g.points.some((p) => p.length > pMax)) continue;
    // Two lines read better than three when the smaller size still fills the frame.
    if (lines.length === 3 && k > 0.8) continue;
    const lineH = Math.round(hs * 1.12), rowH = Math.round(ps * 1.9);
    const gap = Math.round(64 * u * k);
    const points = g.points;
    const total = logoH + gap + lines.length * lineH + (points.length ? gap * 0.8 + points.length * rowH : 0);
    if (total > safeH) continue;
    const top = safeTop + (safeH - total) / 2;
    const headTop = top + logoH + gap;
    const pointsTop = headTop + lines.length * lineH + gap * 0.8;
    // Centre the points as a block under the centred headline.
    const longest = Math.max(0, ...points.map((t) => t.length));
    const blockW = ps * 0.7 + longest * ps * POINT_CHAR;
    const pointsX = Math.round(Math.max(w * 0.06, (w - blockW) / 2));
    return {
      w, h, u, logo: { cx: w / 2, cy: top + markH / 2, scale: markH / LOGO_SIZE[1] },
      word: { size: ws, y: Math.round(top + markH + ws * 1.6) },
      hs, lineH, lines: lines.map((t, i) => ({ text: t, y: Math.round(headTop + i * lineH + hs * 0.82) })),
      ps, rowH, pointsX, points: points.map((t, i) => ({ text: t, y: Math.round(pointsTop + i * rowH + ps * 0.8) })),
      underlineY: Math.round(headTop + lines.length * lineH + gap * 0.25),
    };
  }
  return null;
}

// Beat timing that still lands every element when the beat is short.
// The comp is exactly the scene's length (the caller trims to it), so every
// reveal is scheduled to start with time left to read it.
export function brandBeatTiming(durSec, nPoints) {
  const d = Math.max(0.6, Number(durSec) || 3);
  const draw = Math.min(0.7, d * 0.22);
  const head = draw * 0.55;
  const pointsStart = Math.min(head + 0.7, d * 0.45);
  const lastStart = Math.max(pointsStart, Math.min(d - 0.6, pointsStart + 0.32 * (nPoints - 1)));
  const stagger = nPoints > 1 ? (lastStart - pointsStart) / (nPoints - 1) : 0;
  return { d, draw, head, glint: Math.max(0.05, Math.min(draw + 0.2, d - 0.7)), pointsStart, stagger };
}

// The .jsx that builds comp "Main". Core layers run unguarded so a broken
// build fails loudly (and the worker falls back); embellishments run inside
// try/catch so a missing effect costs polish, not the beat.
export function brandBeatJsx(graphic, { w, h, durSec, fps = 30, logoPath = BRAND_MARK, colors = {} } = {}) {
  const L = brandBeatLayout(graphic, w, h);
  if (!L) return null;
  const T = brandBeatTiming(durSec, L.points.length);
  const bg = rgb(colors.background && /^#?0/.test(colors.background) ? colors.background : "#05060B");
  const data = {
    w, h, fps, d: T.d, T, L, bg, logoPath, size: LOGO_SIZE,
    mark: MARK_COLORS.map(rgb), white: [1, 1, 1], soft: rgb("#C9CED8"),
  };
  return `// generated by signal-render effectcraft.js
var D = ${JSON.stringify(data)};
var warn = [];
function guard(name, f) { try { f(); } catch (e) { warn.push(name + ": " + e); } }
function ease(p, k, inf) {
  for (var n = 1; n <= 3; n++) {
    try {
      var a = [], b = [];
      for (var i = 0; i < n; i++) { a.push(new KeyframeEase(0, inf[0])); b.push(new KeyframeEase(0, inf[1])); }
      p.setTemporalEaseAtKey(k, a, b); return;
    } catch (e) {}
  }
}
function anim(p, t0, t1, v0, v1, inf) {
  p.setValueAtTime(t0, v0); p.setValueAtTime(t1, v1);
  var i = inf || [10, 85];
  ease(p, 1, [i[0], i[0]]); ease(p, 2, [i[1], i[1]]);
}
function tr(l, name) { return l.property("ADBE Transform Group").property(name); }
function text(comp, s, size, font, color, x, y, just) {
  var l = comp.layers.addText(s);
  var p = l.property("ADBE Text Properties").property("ADBE Text Document");
  var doc = p.value;
  doc.fontSize = size; doc.fillColor = color; doc.applyFill = true; doc.applyStroke = false;
  guard("font " + font, function () { doc.font = font; });
  doc.justification = just || ParagraphJustification.CENTER_JUSTIFY;
  doc.tracking = -10;
  p.setValue(doc);
  tr(l, "ADBE Position").setValue([x, y]);
  return l;
}

var comp = app.project.items.addComp("Main", D.w, D.h, 1, D.d, D.fps);
comp.bgColor = D.bg;
var bg = comp.layers.addSolid(D.bg, "Background", D.w, D.h, 1, D.d);

// Two soft brand glows, cyan high and purple low, breathing in.
guard("glows", function () {
  var spots = [[0.28, 0.24, 0], [0.74, 0.78, 2]];
  for (var i = 0; i < spots.length; i++) {
    var g = comp.layers.addShape();
    g.name = "Glow " + i;
    var grp = g.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var el = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
    el.property("ADBE Vector Ellipse Size").setValue([D.w * 0.9, D.w * 0.9]);
    var f = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    f.property("ADBE Vector Fill Color").setValue(D.mark[spots[i][2]]);
    tr(g, "ADBE Position").setValue([D.w * spots[i][0], D.h * spots[i][1]]);
    anim(tr(g, "ADBE Opacity"), 0, 0.8, 0, 22);
    g.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(D.w * 0.18);
  }
});

// The Onixus mark: pops in with a small overshoot, then a slow push.
function keys(p, list) {
  for (var i = 0; i < list.length; i++) p.setValueAtTime(list[i][0], list[i][1]);
  for (var k = 1; k <= list.length; k++) ease(p, k, [k === 1 ? 0 : 70, 70]);
}
var item = app.project.importFile(new ImportOptions(new File(D.logoPath)));
var lp = [D.L.logo.cx, D.L.logo.cy], ls = D.L.logo.scale * 100;
var t0 = 0.05, t1 = t0 + D.T.draw * 0.7, t2 = t0 + D.T.draw;
var scaleKeys = [[t0, [ls * 0.62, ls * 0.62]], [t1, [ls * 1.04, ls * 1.04]], [t2, [ls, ls]], [D.d, [ls * 1.03, ls * 1.03]]];
var logo = comp.layers.add(item);
logo.name = "Onixus";
tr(logo, "ADBE Position").setValue(lp);
keys(tr(logo, "ADBE Scale"), scaleKeys);
anim(tr(logo, "ADBE Opacity"), t0, t0 + D.T.draw * 0.45, 0, 100, [0, 60]);

// A light glint across the mark once it lands.
guard("glint", function () {
  var gl = comp.layers.addSolid([1, 1, 1], "Glint", Math.round(D.w * 0.09), Math.round(D.h * 0.5), 1, D.d);
  tr(gl, "ADBE Rotate Z").setValue(24);
  gl.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(D.w * 0.03);
  var half = D.size[0] * D.L.logo.scale * 0.75;
  anim(tr(gl, "ADBE Position"), D.T.glint, D.T.glint + 0.6, [lp[0] - half, lp[1]], [lp[0] + half, lp[1]], [30, 30]);
  // Visible only while it crosses: in, hold, out.
  keys(tr(gl, "ADBE Opacity"), [[D.T.glint, 0], [D.T.glint + 0.1, 70], [D.T.glint + 0.5, 70], [D.T.glint + 0.6, 0]]);
  gl.blendingMode = BlendingMode.ADD;
  var m = comp.layers.add(item);
  m.name = "Glint matte";
  tr(m, "ADBE Position").setValue(lp);
  keys(tr(m, "ADBE Scale"), scaleKeys);
  m.moveBefore(gl);
  gl.setTrackMatte(m, TrackMatteType.ALPHA);
  guard("hide glint matte", function () { m.enabled = false; });
});

// The ONIXUS wordmark settles under the mark, widely tracked.
guard("wordmark", function () {
  var wm = text(comp, "ONIXUS", D.L.word.size, "Inter-SemiBold", D.soft, D.w / 2, D.L.word.y);
  wm.name = "Wordmark";
  var p = wm.property("ADBE Text Properties").property("ADBE Text Document");
  var doc = p.value; doc.tracking = 600; p.setValue(doc);
  var a = t0 + D.T.draw * 0.6;
  anim(tr(wm, "ADBE Position"), a, a + 0.45, [D.w / 2, D.L.word.y + D.L.word.size * 0.8], [D.w / 2, D.L.word.y], [0, 90]);
  anim(tr(wm, "ADBE Opacity"), a, a + 0.35, 0, 100, [0, 60]);
});

// Headline: solid white, each line rising in on its own beat.
for (var i = 0; i < D.L.lines.length; i++) {
  var ln = D.L.lines[i];
  var tl = text(comp, ln.text, D.L.hs, "Inter-Bold", D.white, D.w / 2, ln.y);
  tl.name = "Headline " + (i + 1);
  var a = D.T.head + i * 0.11;
  anim(tr(tl, "ADBE Position"), a, a + 0.5, [D.w / 2, ln.y + D.L.hs * 0.55], [D.w / 2, ln.y], [0, 92]);
  anim(tr(tl, "ADBE Opacity"), a, a + 0.35, 0, 100, [0, 60]);
}

// A short accent rule under the headline, drawn in the mark's blue.
guard("rule", function () {
  var r = comp.layers.addShape();
  r.name = "Rule";
  var grp = r.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var rect = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
  rect.property("ADBE Vector Rect Size").setValue([D.w * 0.14, Math.max(4, Math.round(D.L.hs * 0.07))]);
  var f = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
  f.property("ADBE Vector Fill Color").setValue(D.mark[1]);
  tr(r, "ADBE Position").setValue([D.w / 2, D.L.underlineY]);
  var a = D.T.head + D.L.lines.length * 0.11 + 0.2;
  anim(tr(r, "ADBE Scale"), a, a + 0.45, [0, 100], [100, 100], [0, 90]);
});

// Points: a chevron bullet in the mark's colours, then the words sliding in.
for (var j = 0; j < D.L.points.length; j++) {
  var pt = D.L.points[j];
  var t = D.T.pointsStart + j * D.T.stagger;
  var x0 = D.L.pointsX;
  var bullet = comp.layers.addShape();
  bullet.name = "Bullet " + (j + 1);
  var bg2 = bullet.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  var bp = bg2.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
  var c = D.L.ps * 0.32, sh2 = new Shape();
  sh2.vertices = [[-c * 0.6, -c], [c * 0.6, 0], [-c * 0.6, c]]; sh2.closed = false;
  bp.property("ADBE Vector Shape").setValue(sh2);
  var bs = bg2.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
  bs.property("ADBE Vector Stroke Color").setValue(D.mark[Math.min(2, j)]);
  bs.property("ADBE Vector Stroke Width").setValue(Math.max(3, D.L.ps * 0.14));
  var by = pt.y - D.L.ps * 0.33;
  anim(tr(bullet, "ADBE Position"), t, t + 0.4, [x0 - D.L.ps, by], [x0, by], [0, 90]);
  anim(tr(bullet, "ADBE Opacity"), t, t + 0.25, 0, 100, [0, 60]);
  var tx = text(comp, pt.text, D.L.ps, "Inter-SemiBold", D.soft, x0 + D.L.ps * 0.7, pt.y, ParagraphJustification.LEFT_JUSTIFY);
  tx.name = "Point " + (j + 1);
  anim(tr(tx, "ADBE Position"), t + 0.06, t + 0.5, [x0 + D.L.ps * 1.6, pt.y], [x0 + D.L.ps * 0.7, pt.y], [0, 90]);
  anim(tr(tx, "ADBE Opacity"), t + 0.06, t + 0.36, 0, 100, [0, 60]);
}
JSON.stringify({ ok: true, layers: comp.numLayers, warn: warn });
`;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`effectcraft timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`effectcraft-cli ${args[0]} exited ${code}: ${(err || out).slice(-600)}`));
    });
  });
}

// Build and render one beat to a silent MP4 at w×h. Resolves to
// {ok:true, ms, warn} or {ok:false, error}; never throws.
export async function renderBrandBeat(graphic, outPath, { w, h, durSec, dir, idx = 0, colors, bin = effectcraftCli(), timeoutMs = 180000 } = {}) {
  if (!bin) return { ok: false, error: "effectcraft-cli not installed" };
  const t0 = Date.now();
  try {
    const jsx = brandBeatJsx(graphic, { w, h, durSec, colors });
    if (!jsx) return { ok: false, error: "graphic has no headline or does not fit" };
    const jsxPath = join(dir, `beat-${idx}.jsx`), proj = join(dir, `beat-${idx}.ecproj`);
    await writeFile(jsxPath, jsx);
    const built = await run(bin, ["script", jsxPath, "--empty", "--save-as", proj, "--json"], timeoutMs);
    let warn = [];
    try { warn = JSON.parse(JSON.parse(built.out.trim().split("\n").pop()).result || "{}").warn ?? []; } catch { /* informational */ }
    await run(bin, ["render", proj, "--comp", "Main", "--out", outPath], timeoutMs);
    if (!existsSync(outPath)) return { ok: false, error: "render produced no file" };
    return { ok: true, ms: Date.now() - t0, warn };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
