// Remotion motion path (render_style "motion"): Signal's BeatStory ad.
//
// The bundle is built once per process and reused. Remotion drives the system
// Chromium (CHROMIUM_PATH) in chrome-for-testing mode; the visual renders
// muted and server.js muxes voiceover and music with ffmpeg, exactly like the
// cinematic path, so audio handling stays in one place.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

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
    media: s.endcard ? "endcard" : s.media === "site_screenshot" || /-site-\d+\.(jpe?g|png)$/i.test(String(s.image_path || "")) ? "site" : "photo",
    imageSrc: s.image_url || null,
  }));
  const colors = Array.isArray(p?.brand?.colors) ? p.brand.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))) : [];
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

/** Render the muted BeatStory video to outPath. */
export async function renderBeatStory({ props, outPath, onProgress }) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const browserExecutable = process.env.REMOTION_CHROME || process.env.CHROMIUM_PATH || undefined;
  const chromeMode = browserExecutable ? "chrome-for-testing" : "headless-shell";
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id: "BeatStory", inputProps: props, browserExecutable, chromeMode });
  await renderMedia({
    composition, serveUrl, codec: "h264", outputLocation: outPath,
    inputProps: props, browserExecutable, chromeMode, muted: true,
    concurrency: 1, crf: 20, pixelFormat: "yuv420p", colorSpace: "bt709", timeoutInMilliseconds: 120000,
    onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  });
}
