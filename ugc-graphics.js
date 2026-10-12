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

/** Soft accent glows that drift behind every layout, so a graphic never sits flat. */
function glowEvents(durMs, w, h, accent, accent2) {
  const end = msToAss(durMs);
  const r = Math.round(Math.min(w, h) * 0.42);
  const circle = (rad) => `m ${rad} 0 b ${rad * 1.55} 0 ${rad * 2} ${rad * 0.45} ${rad * 2} ${rad} b ${rad * 2} ${rad * 1.55} ${rad * 1.55} ${rad * 2} ${rad} ${rad * 2} b ${rad * 0.45} ${rad * 2} 0 ${rad * 1.55} 0 ${rad} b 0 ${rad * 0.45} ${rad * 0.45} 0 ${rad} 0`;
  const t = Math.max(1, durMs);
  return [
    `Dialogue: 0,${msToAss(0)},${end},Gfx,,0,0,0,,{\\an7\\move(${Math.round(-r * 0.6)},${Math.round(h * 0.08)},${Math.round(-r * 0.3)},${Math.round(h * 0.16)},0,${t})\\1c${accent}\\1a&HB4&\\blur${Math.round(r * 0.35)}\\bord0\\shad0\\p1}${circle(r)}{\\p0}`,
    `Dialogue: 0,${msToAss(0)},${end},Gfx,,0,0,0,,{\\an7\\move(${Math.round(w - r * 1.2)},${Math.round(h * 0.58)},${Math.round(w - r * 1.5)},${Math.round(h * 0.5)},0,${t})\\1c${accent2}\\1a&HC8&\\blur${Math.round(r * 0.35)}\\bord0\\shad0\\p1}${circle(Math.round(r * 0.8))}{\\p0}`,
  ];
}

/** Which of the three layouts a beat uses; rotates so consecutive graphics differ. */
export function graphicVariant(seed) {
  return ["kinetic", "highlight", "chips"][Math.abs(Number(seed) || 0) % 3];
}

/**
 * Full-frame motion-graphic beat over the brand's dark backdrop, drawn as
 * animated ASS so the words are exact. Three layouts:
 *  - kinetic:   the headline lands word by word, the key word in the accent;
 *  - highlight: left-aligned headline with an accent marker wiping in behind it;
 *  - chips:     big centred headline, points pop in as outlined pills.
 */
export function buildGraphicAss(graphic, durMs, w, h, colors = {}, seed = 0) {
  const g = normalizeGraphic(graphic);
  if (!g) return null;
  const variant = graphicVariant(seed);
  const accent = assColor(colors.accent || colors.primary);
  const accent2 = assColor(colors.secondary || colors.primary || colors.accent);
  const portrait = w < h;
  const cx = Math.round(w / 2);
  const end = msToAss(durMs);
  const ev = glowEvents(durMs, w, h, accent, accent2);
  // Lay the block out at a type size: headline and points both wrap to the
  // frame's real width at that size, and each point's block grows with its
  // line count.
  const layout = (hs) => {
    const headLines = wrapLines(g.headline.toUpperCase(), Math.max(8, Math.floor((w * 0.86) / (hs * 0.66))));
    const ps = Math.round(hs * 0.6);
    const lineH = Math.round(hs * 1.08);
    const pointStep = Math.round(ps * 1.9);
    const ptChars = Math.max(10, Math.floor((w * 0.82) / (ps * 0.56)));
    const ptLines = g.points.map((p) => wrapLines(p, ptChars));
    const ptLineH = Math.round(ps * 1.15);
    const ptH = ptLines.map((l) => l.length * ptLineH);
    const ptGap = pointStep - ptLineH;
    const pointsH = ptH.reduce((a, b) => a + b, 0) + Math.max(0, g.points.length - 1) * ptGap;
    const blockH = headLines.length * lineH + (g.points.length ? Math.round(hs * 0.9) + pointsH : 0);
    return { hs, ps, lineH, headLines, ptLines, ptH, ptGap, blockH };
  };
  // Shrink the type until the whole block fits the frame's safe area, so a
  // long headline plus three wrapped points never runs off the bottom.
  const safeH = h * 0.84;
  let L = layout(Math.round(h * (portrait ? 0.066 : w === h ? 0.075 : 0.09)));
  for (let k = 0; k < 4 && L.blockH > safeH; k++) L = layout(Math.max(12, Math.floor(L.hs * (safeH / L.blockH))));
  const { hs, ps, lineH, headLines, ptLines, ptH, ptGap, blockH } = L;
  // A little above centre; never above 16% when there is room, and never so
  // low that the block runs past 92% of the frame.
  const maxTop = Math.max(Math.round(h * 0.08), Math.round(h * 0.92 - blockH));
  const minTop = Math.min(Math.round(h * 0.16), maxTop);
  const top = Math.min(maxTop, Math.max(minTop, Math.round((h - blockH) / 2 - h * 0.06)));
  const headBottom = top + headLines.length * lineH;
  const pointTop = (i) => headBottom + Math.round(hs * 0.9) + ptH.slice(0, i).reduce((a, b) => a + b, 0) + i * ptGap;
  const pointsAt = (i) => pointTop(i) + Math.round(ptH[i] / 2);
  const ptText = (i) => ptLines[i].join("\\N");
  const pointStart = (i) => 900 + i * 380;

  if (variant === "kinetic") {
    // Word by word: each word pops from 135% with a quick fade; the last word
    // (the payoff) takes the accent colour.
    let k = 0;
    const words = headLines.flatMap((line) => line.split(" "));
    headLines.forEach((line, li) => {
      const y = top + li * lineH + Math.round(lineH / 2);
      const lineWords = line.split(" ");
      const lineText = lineWords.map((word) => {
        const t0 = 80 + k * 150;
        const isLast = k === words.length - 1;
        k++;
        return `{\\alpha&HFF&\\fscx135\\fscy135\\t(${t0},${t0 + 1},\\alpha&H00&)\\t(${t0},${t0 + 220},\\fscx100\\fscy100)${isLast ? `\\1c${accent}` : ""}}${word}`;
      }).join(" ");
      ev.push(`Dialogue: 2,${msToAss(0)},${end},Head,,0,0,0,,{\\an5\\pos(${cx},${y})}${lineText}`);
    });
    g.points.forEach((p, i) => {
      const t0 = 80 + words.length * 150 + 250 + i * 330;
      if (t0 >= durMs - 300) return;
      ev.push(`Dialogue: 2,${msToAss(t0)},${end},Point,,0,0,0,,{\\an5\\move(${cx},${pointsAt(i) + 30},${cx},${pointsAt(i)},0,260)\\fad(180,160)}{\\1c${accent}}●{\\1c&HFFFFFF&}  ${ptText(i)}`);
    });
  } else if (variant === "highlight") {
    // Left aligned. An accent marker wipes in behind each headline line (a
    // boxed copy revealed by an animated clip), then the white type settles.
    const x = Math.round(w * 0.08);
    headLines.forEach((line, li) => {
      const y = top + li * lineH;
      const t0 = 100 + li * 180;
      ev.push(`Dialogue: 1,${msToAss(t0)},${end},Mark,,0,0,0,,{\\an7\\pos(${x},${y})\\3c${accent}\\clip(0,0,${Math.max(0, x - Math.round(hs * 0.2))},${h})\\t(0,320,\\clip(0,0,${w},${h}))}${line}`);
      ev.push(`Dialogue: 2,${msToAss(t0 + 120)},${end},HeadL,,0,0,0,,{\\an7\\move(${x + 24},${y},${x},${y},0,260)\\fad(160,160)}${line}`);
    });
    g.points.forEach((p, i) => {
      const t0 = pointStart(i);
      if (t0 >= durMs - 300) return;
      const y = pointTop(i);
      ev.push(`Dialogue: 2,${msToAss(t0)},${end},PointL,,0,0,0,,{\\an7\\move(${x - 60},${y},${x},${y},0,300)\\fad(180,160)}{\\1c${accent}}—{\\1c&HFFFFFF&}  ${ptText(i)}`);
    });
  } else {
    // Chips: headline rises in; each point pops in as an accent-outlined pill.
    headLines.forEach((line, li) => {
      const y = top + li * lineH + Math.round(lineH / 2);
      const t0 = 100 + li * 90;
      ev.push(`Dialogue: 2,${msToAss(t0)},${end},Head,,0,0,0,,{\\an5\\move(${cx},${y + 60},${cx},${y},0,380)\\fscx94\\fscy94\\t(0,380,\\fscx100\\fscy100)\\fad(200,160)}${line}`);
    });
    g.points.forEach((p, i) => {
      const t0 = pointStart(i);
      if (t0 >= durMs - 300) return;
      ev.push(`Dialogue: 2,${msToAss(t0)},${end},Chip,,0,0,0,,{\\an5\\pos(${cx},${pointsAt(i)})\\3c${accent}\\3a&H30&\\fscx70\\fscy70\\alpha&HFF&\\t(0,120,\\alpha&H00&)\\t(0,240,\\fscx104\\fscy104)\\t(240,340,\\fscx100\\fscy100)}${ptText(i)}`);
    });
  }
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
    `Style: HeadL,Arial,${hs},&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,1,0,1,0,3,7,0,0,0,1`,
    `Style: Mark,Arial,${hs},&HFFFFFFFF,&H00F6A33B,&H00F6A33B,1,0,0,0,100,100,1,0,3,${Math.round(hs * 0.14)},0,7,0,0,0,1`,
    `Style: PointL,Arial,${ps},&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,2,7,0,0,0,1`,
    `Style: Chip,Arial,${ps},&H00FFFFFF,&H00F6A33B,&H00F6A33B,1,0,0,0,100,100,1,0,3,${Math.max(8, Math.round(ps * 0.36))},0,5,0,0,0,1`,
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
