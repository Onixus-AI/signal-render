// Motion graphics for UGC founder ads, drawn as animated ASS subtitles so the
// words are exact (never a diffusion model's guess at lettering) and the
// worker needs nothing beyond the ffmpeg + libass it already burns captions
// with. Pure string builders, so the layout is unit-testable.

/** "#7C3AED" -> ASS override colour "&HED3A7C&" (BBGGRR). Falls back on bad input. */
export function assColor(hex, fallback = "&HF6A33B&") {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return fallback;
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H${b}${g}${r}&`.toUpperCase();
}

export function msToAss(ms) {
  const cs = Math.max(0, Math.round(Number(ms) / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (t) => String(t ?? "").replace(/\r?\n/g, " ").replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Greedy word wrap to at most `maxChars` per line; joined with ASS \N. */
export function wrapLines(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const w of clean(text).split(" ").filter(Boolean)) {
    if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Keep a graphic to what reads in a few seconds: short headline, <= 3 points. */
export function normalizeGraphic(g) {
  const headline = clean(g?.headline).split(" ").slice(0, 7).join(" ");
  const points = (Array.isArray(g?.points) ? g.points : [])
    .map((p) => clean(p).split(" ").slice(0, 6).join(" "))
    .filter(Boolean)
    .slice(0, 3);
  return headline ? { headline, points } : null;
}

/**
 * Full-frame graphic beat: an accent bar draws in, the headline punches up
 * into place, then each point slides in on its own beat. Brand accent colour,
 * white type, on the dark backdrop the clip is rendered over.
 */
export function buildGraphicAss(graphic, durMs, w, h, colors = {}) {
  const g = normalizeGraphic(graphic);
  if (!g) return null;
  const accent = assColor(colors.accent || colors.primary);
  const hs = Math.round(h * (w < h ? 0.064 : 0.09));
  const ps = Math.round(hs * 0.62);
  const cx = Math.round(w / 2);
  const headLines = wrapLines(g.headline.toUpperCase(), w < h ? 13 : 22);
  const lineH = Math.round(hs * 1.1);
  const pointStep = Math.round(ps * 1.85);
  // Centre the whole block (headline + points) a little above the middle,
  // clear of the caption band, instead of pinning it to the top.
  const blockH = headLines.length * lineH + (g.points.length ? Math.round(hs * 0.9) + g.points.length * pointStep : 0);
  const blockTop = Math.max(Math.round(h * 0.16), Math.round((h - blockH) / 2 - h * 0.06));
  const headBottom = blockTop + headLines.length * lineH;
  const end = msToAss(durMs);
  const ev = [];
  // Accent bar above the headline: grows out from the centre.
  const barW = Math.round(w * 0.18), barH = Math.max(10, Math.round(h * 0.007));
  ev.push(`Dialogue: 1,${msToAss(0)},${end},Gfx,,0,0,0,,{\\an5\\pos(${cx},${blockTop - Math.round(hs * 0.55)})\\1c${accent}\\bord0\\shad0\\fscx0\\t(0,380,\\fscx100)\\p1}m 0 0 l ${barW} 0 ${barW} ${barH} 0 ${barH}{\\p0}`);
  // Headline: rises 70px into place, scales from 92%, fades in.
  headLines.forEach((line, i) => {
    const y = blockTop + i * lineH + Math.round(lineH / 2);
    const t0 = 120 + i * 90;
    ev.push(`Dialogue: 2,${msToAss(t0)},${end},Head,,0,0,0,,{\\an5\\move(${cx},${y + 70},${cx},${y},0,420)\\fscx92\\fscy92\\t(0,420,\\fscx100\\fscy100)\\fad(220,180)}${line}`);
  });
  // Points: each slides in from the left on its own beat, accent marker first.
  g.points.forEach((p, i) => {
    const y = headBottom + Math.round(hs * 0.9) + i * pointStep;
    const t0 = 650 + i * 420;
    if (t0 >= durMs - 300) return;
    ev.push(`Dialogue: 2,${msToAss(t0)},${end},Point,,0,0,0,,{\\an5\\move(${cx - 60},${y},${cx},${y},0,320)\\fad(200,180)}{\\1c${accent}}●{\\1c&HFFFFFF&}  ${p}`);
  });
  return assDoc(w, h, hs, ps, ev);
}

/** Name tag on a talking head: name over title, slides in, holds, fades. */
export function lowerThirdEvents(tag, startMs, endMs, w, h, colors = {}) {
  const name = clean(tag?.name), title = clean(tag?.title);
  if (!name) return [];
  const accent = assColor(colors.accent || colors.primary);
  const s = startMs + 300, e = Math.min(endMs, startMs + 3800);
  if (e - s < 800) return [];
  const x = Math.round(w * 0.07), y = Math.round(h * 0.835);
  const out = [
    `Dialogue: 3,${msToAss(s)},${msToAss(e)},TagName,,0,0,0,,{\\an1\\move(${x - 80},${y},${x},${y},0,350)\\fad(200,250)}{\\1c${accent}}▍{\\1c&HFFFFFF&}${name}`,
  ];
  if (title) out.push(`Dialogue: 3,${msToAss(s + 150)},${msToAss(e)},TagTitle,,0,0,0,,{\\an7\\move(${x - 80},${y + 8},${x + 34},${y + 8},0,350)\\fad(200,250)}${title}`);
  return out;
}

/** ASS styles shared by graphics and name tags (sized from the frame). */
export function graphicStyles(h, hs = Math.round(h * 0.064), ps = Math.round(hs * 0.62)) {
  const tag = Math.round(h * 0.036);
  return [
    `Style: Gfx,Arial,10,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: Head,Arial,${hs},&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,1,0,1,0,3,5,40,40,0,1`,
    `Style: Point,Arial,${ps},&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,2,5,40,40,0,1`,
    `Style: TagName,Arial,${tag},&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,2,1,0,0,0,1`,
    `Style: TagTitle,Arial,${Math.round(tag * 0.62)},&H00E6E6E6,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,2,1,7,0,0,0,1`,
  ];
}

function assDoc(w, h, hs, ps, events) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${graphicStyles(h, hs, ps).join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}
