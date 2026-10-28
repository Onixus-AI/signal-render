// Remotion motion path (render_style "motion"): Signal's BeatStory ad.
//
// The bundle is built once per process and reused. Remotion drives the system
// Chromium (CHROMIUM_PATH) in chrome-for-testing mode; the visual renders
// muted and server.js muxes voiceover and music with ffmpeg, exactly like the
// cinematic path, so audio handling stays in one place.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const GRAPHIC_TYPES = ["strike_list", "flow", "before_after", "icon_row"];
const ICON_NAMES = ["phone", "calendar", "chat", "check", "clock", "user", "globe", "bolt", "star", "dollar", "mail", "cart", "chart", "home", "wrench", "doc"];
const txt = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** Validate a motion-graphic spec from Signal; anything malformed is dropped. */
export function cleanGraphic(g) {
  if (!g || typeof g !== "object" || !GRAPHIC_TYPES.includes(g.type)) return null;
  const items = (Array.isArray(g.items) ? g.items : []).slice(0, 5).map((it) => ({
    label: txt(it?.label ?? it, 40),
    icon: ICON_NAMES.includes(it?.icon) ? it.icon : "check",
    struck: it?.struck === true,
  })).filter((it) => it.label);
  const list = (a) => (Array.isArray(a) ? a : []).slice(0, 3).map((x) => txt(x, 40)).filter(Boolean);
  const out = { type: g.type, items, before: list(g.before), after: list(g.after), before_title: txt(g.before_title, 24), after_title: txt(g.after_title, 24) };
  if (g.type === "before_after" ? !(out.before.length && out.after.length) : items.length < 2) return null;
  return out;
}

/** Pure: worker payload -> BeatStory props. Exported for tests. */
export function buildBeatStoryProps(p, width = 1080, height = 1920) {
  const planScenes = Array.isArray(p?.plan?.scenes) ? p.plan.scenes : [];
  const beatByIdx = new Map(planScenes.map((s) => [Number(s.idx), String(s.beat || "")]));
  const scenes = [...(p?.scenes || [])].sort((a, b) => a.idx - b.idx).map((s, i, all) => ({
    idx: s.idx,
    startMs: Number(s.start_ms) || 0,
    endMs: Number(s.end_ms) || 0,
    text: String(s.on_screen_text || "").trim(),
    beat: String(s.beat || beatByIdx.get(Number(s.idx)) || (i === all.length - 1 ? "cta" : "")),
    media: s.endcard ? "endcard" : s.media === "text_only" ? "text" : s.media === "site_screenshot" || /-site-\d+\.(jpe?g|png)$/i.test(String(s.image_path || "")) ? "site" : "photo",
    // A picture that failed Signal's "does it show what the scene says" check
    // is left out rather than shown: never confuse the viewer.
    imageSrc: s.media === "text_only" ? null : s.image_url || null,
    graphic: cleanGraphic(s.graphic),
  }));
  // Signal sends { primary, secondary, accent }; older payloads send a list.
  const rawColors = p?.brand?.colors;
  const colorList = Array.isArray(rawColors) ? rawColors
    : rawColors && typeof rawColors === "object" ? [rawColors.primary, rawColors.accent, rawColors.secondary] : [];
  const colors = colorList.filter((c) => /^#[0-9a-f]{6}$/i.test(String(c)));
  const totalMs = Math.max(1000, ...scenes.map((s) => s.endMs));
  return {
    width, height, totalMs, scenes,
    brand: {
      primary: colors[0] || "#9254FF",
      accent: colors[1] || "#00CBE8",
      businessName: p?.brand?.business_name || "",
      logoUrl: p?.brand?.logo_url || null,
      tagline: p?.brand?.tagline || "",
      website: p?.brand?.website || "",
    },
    cta: String(p?.cta?.text || "").trim().slice(0, 48),
    // The Rise: two doors on the end card (main action, low-commitment step).
    ctaDoors: (Array.isArray(p?.plan?.cta_doors) ? p.plan.cta_doors : []).map((d) => String(d || "").trim().slice(0, 40)).filter(Boolean).slice(0, 2),
    fonts: {
      heading: String(p?.fonts?.heading || "Inter").slice(0, 60),
      body: String(p?.fonts?.body || "Inter").slice(0, 60),
    },
    eyebrow: String(p?.eyebrow || "").slice(0, 40),
  };
}

let serveUrlPromise = null;
async function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({ entryPoint: join(HERE, "motion", "index.js") });
    })().catch((e) => { serveUrlPromise = null; throw e; });
  }
  return serveUrlPromise;
}

export function remotionAvailable() {
  return Boolean(process.env.CHROMIUM_PATH || process.env.REMOTION_CHROME);
}

/**
 * Pure: worker payload + this job's scene times and local clip URLs ->
 * Cinematic props. Exported for tests. Only 9:16 is laid out.
 */
export function buildCinematicProps(p, scenes, clipUrls = []) {
  const base = buildBeatStoryProps({ ...p, scenes }, 1080, 1920);
  const raw = [...scenes].sort((a, b) => a.idx - b.idx);
  const rc = p?.brand?.colors;
  const list = Array.isArray(rc) ? rc : rc && typeof rc === "object" ? [rc.primary, rc.accent, rc.secondary] : [];
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : null);
  return {
    ...base,
    scenes: base.scenes.map((s, i) => ({ ...s, videoSrc: clipUrls[i] || null, media: s.media === "photo" && !clipUrls[i] && raw[i]?.endcard ? "endcard" : s.media })),
    brand: { ...base.brand, lockupUrl: p?.brand?.lockup_url || null, magenta: hex(list[2]) || base.brand.primary, green: hex(list[3]) || base.brand.accent },
  };
}

/** Render the muted BeatStory video to outPath. */
export async function renderBeatStory({ props, outPath, onProgress, composition: id = "BeatStory" }) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = process.env.REMOTION_CHROME || process.env.CHROMIUM_PATH || undefined;
  const chromeMode = browserExecutable ? "chrome-for-testing" : "headless-shell";
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id, inputProps: props, browserExecutable, chromeMode });
  await renderMedia({
    composition, serveUrl, codec: "h264", outputLocation: outPath,
    inputProps: props, browserExecutable, chromeMode, muted: true,
    concurrency: 1, crf: 20, pixelFormat: "yuv420p", colorSpace: "bt709", timeoutInMilliseconds: 120000,
    onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  });
}

/**
 * A TWIN graphic beat ({ headline, points }) as one Remotion clip in the
 * motion-ad style: two or more points become a step flow, a headline alone
 * plays as a big animated headline. Pure; exported for tests.
 */
export function twinGraphicProps(graphic, { width = 1080, height = 1920, durSec = 3, colors = {}, businessName = "", logoUrl = null } = {}) {
  const headline = String(graphic?.headline || "").trim().slice(0, 80);
  const points = (Array.isArray(graphic?.points) ? graphic.points : []).map((x) => String(x || "").trim().slice(0, 40)).filter(Boolean).slice(0, 4);
  const flow = points.length >= 2
    ? { type: "flow", items: points.map((label) => ({ label, icon: "check", struck: false })), before: [], after: [], before_title: "", after_title: "" }
    : null;
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : null);
  return {
    width, height, totalMs: Math.max(1000, Math.round(durSec * 1000)), clip: true,
    scenes: [{ idx: 1, startMs: 0, endMs: Math.max(1000, Math.round(durSec * 1000)), text: headline, beat: flow ? "twin_graphic" : "promise", media: "text", imageSrc: null, graphic: flow }],
    brand: { primary: hex(colors.primary) || "#9254FF", accent: hex(colors.accent) || hex(colors.secondary) || "#00CBE8", businessName, logoUrl, tagline: "", website: "" },
    cta: "", ctaDoors: [], fonts: { heading: "Inter", body: "Inter" }, eyebrow: "",
  };
}
