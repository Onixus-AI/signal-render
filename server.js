import { deliverRenderStatus } from "./status-delivery.js";
import {AD_CANVASES,adaptationArgs,adaptationUrl} from './ad-adaptation.js';
// signal-render — stateless video worker.
// Uploads via signed-URL PUTs; reports status back through the authenticated
// signal-video-complete edge function. Never talks to Supabase directly and
// never holds the service role key.
//
// Env:
//   RENDER_TOKEN          (required) — shared secret, used as bearer for status callbacks
//                                      and to authenticate inbound /render-video and /render.
//   SUPABASE_URL          (required) — used to build the status callback endpoint.
//   RENDER_HTML_TOKEN     (optional) — separate secret for /render-html; open when unset.
//   CHROMIUM_PATH         (optional) — chromium binary; resolved from PATH when unset.
//   MAX_HTML_CONCURRENCY  (default 2) — simultaneous Chromium pages across /render, /render-html
//                                      and /screenshot-url.
//   SCREENSHOT_ALLOWED_HOSTS (default onixus.xyz,www.onixus.xyz) — the only hosts /screenshot-url loads.
//   PORT                  (default 8080)

import express from "express";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter as PATH_DELIM } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import {
  buildStillMotionFilter,
  normalizeTransitionIntent,
  planMotionTreatments,
  planTransitions,
  transitionDuration,
} from "./motion-director.js";
import { allowedCaptureUrl, captureOptions, looksLikeBotChallenge, parseAllowedHosts, pickFocusOffset, stripWindow } from "./site-capture.js";
import { retimeScenes, ugcStretchDurations, voiceoverFitPlan } from "./ugc-timing.js";
import { buildGraphicAss, graphicStyles, lowerThirdEvents } from "./ugc-graphics.js";
import { effectcraftCli, renderBrandBeat } from "./effectcraft.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "templates");

// ffmpeg/ffprobe resolution: prefer the bundled static binaries so the worker
// renders under any Railway builder (Nixpacks/Railpack images ship no ffmpeg);
// fall back to PATH for the Dockerfile build.
let FFMPEG = "ffmpeg";
let FFPROBE = "ffprobe";
try {
  const { default: p } = await import("ffmpeg-static");
  if (p) FFMPEG = p;
} catch {}
try {
  const { default: p } = await import("ffprobe-static");
  if (p?.path) FFPROBE = p.path;
} catch {}

const app = express();
app.use(express.json({ limit: "5mb" }));

const RENDER_TOKEN = process.env.RENDER_TOKEN;
// Separate, lower-stakes secret for /render-html so callers that only need a
// PNG from HTML don't need the same token that authorizes video jobs and
// signed-upload callbacks. Optional: if unset, /render-html is open (matches
// the free public render APIs it replaces — e.g. PageShot — which shipped
// with no auth at all).
// Trimmed: tokens pasted from a terminal often carry a trailing newline, and
// a stray "\n" on either side must not turn into a silent 401.
const HTML_RENDER_TOKEN = (process.env.RENDER_HTML_TOKEN || "").trim() || undefined;
const SCREENSHOT_HOSTS = parseAllowedHosts(process.env.SCREENSHOT_ALLOWED_HOSTS);
// Chromium binary: honor CHROMIUM_PATH when it points at a real file, else
// search PATH (Nixpacks puts it in /nix/store, Debian at /usr/bin). puppeteer
// requires an absolute path that exists, so a bare "chromium" is resolved here.
function resolveChromium() {
  const candidates = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  for (const dir of (process.env.PATH || "").split(PATH_DELIM)) {
    for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
      const full = join(dir, name);
      if (dir && existsSync(full)) return full;
    }
  }
  return process.env.CHROMIUM_PATH || "/usr/bin/chromium";
}
const CHROMIUM_PATH = resolveChromium();
// Chromium pages are memory-heavy and share one small vCPU with ffmpeg; cap
// how many render at once and queue the rest instead of letting a burst of
// requests OOM the container (which would take video rendering down with it).
const MAX_HTML_CONCURRENCY = Math.max(1, Number(process.env.MAX_HTML_CONCURRENCY) || 2);
const SUPABASE_URL = process.env.SUPABASE_URL;
const PORT = Number(process.env.PORT || 8080);
const STATUS_ENDPOINT = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/signal-video-complete`
  : null;

/** @type {Map<string, { status: "queued"|"rendering"|"done"|"failed", finished_at?: number }>} */
const jobs = new Map();
// Terminal jobs are kept an hour so UI retries still dedupe, then dropped.
const JOB_TTL_MS = 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) if (j.finished_at && j.finished_at < cutoff) jobs.delete(id);
}, 5 * 60 * 1000).unref();

// Every network call and every ffmpeg invocation is bounded. Renders run
// serially, so one hung download or encode would otherwise block every job
// behind it until the container was restarted.
const TIMEOUTS = {
  asset_fetch_ms: 60_000,     // scene stills / stock clips / voiceover / music / logo
  upload_ms: 180_000,         // signed PUT of the finished MP4
  status_ms: 15_000,          // callback to signal-video-complete
  ffmpeg_ms: 10 * 60_000,     // any single ffmpeg pass
  ffprobe_ms: 30_000,
  html_render_ms: 20_000,     // page load + assets for /render and /render-html
};

function fetchWithTimeout(url, opts = {}, ms = TIMEOUTS.asset_fetch_ms) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// Tiny counting semaphore for Chromium pages.
function makeSemaphore(n) {
  let active = 0;
  const waiters = [];
  return {
    get active() { return active; },
    get waiting() { return waiters.length; },
    async acquire() {
      if (active < n) { active++; return; }
      await new Promise((resolve) => waiters.push(resolve));
      active++;
    },
    release() {
      active--;
      const next = waiters.shift();
      if (next) next();
    },
  };
}
const pageSlots = makeSemaphore(MAX_HTML_CONCURRENCY);

function hasFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ["-version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function boundedDiagnostic(value, max = 500) {
  return String(value || "")
    .replace(/[A-Za-z0-9_-]{24,}/g, "redacted")
    .replace(/https?:\/\/\S+/g, "redacted-url")
    .replace(/[A-Z]:\\[^\s]+/g, "redacted-path")
    .replace(/\/(?:tmp|app)\/[^\s]+/g, "redacted-path")
    .slice(0, max);
}

function ffmpegVersion() {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ["-version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve("unknown"));
    p.on("exit", () => resolve((out.split("\n")[0] || "unknown").trim()));
  });
}

// ---- Captions (ASS subtitle) helpers ----
function msToAss(ms) {
  const cs = Math.max(0, Math.round(Number(ms) / 10)); // centiseconds
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
function assEscape(t) {
  return String(t).replace(/\r?\n/g, " ").replace(/\{/g, "(").replace(/\}/g, ")").trim();
}
// Build a styled ASS caption track from per-scene on_screen_text + timings.
function buildAss(scenes, width, height) {
  const fs = Math.max(28, Math.round(height * 0.05));
  const marginV = Math.round(height * 0.1);
  const header =
    `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,${fs},&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,4,1,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const dialogue = (scenes || [])
    .filter((s) => s && s.on_screen_text && String(s.on_screen_text).trim())
    .map((s) => `Dialogue: 0,${msToAss(s.start_ms)},${msToAss(s.end_ms)},Cap,,0,0,0,,${assEscape(s.on_screen_text)}`);
  return `${header}\n${dialogue.join("\n")}\n`;
}

// ---- UGC captions: 2-4 words at a time, timed evenly across each scene's
// narration (mirrors chunkUgcCaptions in supabase/functions/_shared/ugc.ts).
function chunkUgcCaptions(text, startMs, endMs, wordsPerChunk = 3) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const span = Math.max(0, endMs - startMs);
  if (words.length === 0 || span <= 0) return [];
  const per = Math.max(1, Math.min(6, Math.round(wordsPerChunk)));
  // Break early at punctuation so a group never straddles a clause.
  const groups = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= per || /[.,!?;:]$/.test(w)) { groups.push(cur.join(" ")); cur = []; }
  }
  if (cur.length) groups.push(cur.join(" "));
  const weights = groups.map((g) => Math.max(1, g.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = startMs;
  return groups.map((g, i) => {
    const dur = i === groups.length - 1 ? endMs - cursor : Math.round((span * weights[i]) / total);
    const chunk = { start_ms: cursor, end_ms: Math.min(endMs, cursor + dur), text: g };
    cursor = chunk.end_ms;
    return chunk;
  });
}

// Creator-video caption track: big, bold, upper-case word groups sitting just
// below centre so they never cover the mouth. Talking scenes caption the
// narration; the end-card keeps its sign-off text.
function buildUgcAss(scenes, width, height, colors = {}, { captions = true } = {}) {
  const fs = Math.max(40, Math.round(height * 0.052));
  const marginV = Math.round(height * 0.3);
  const header =
    `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Ugc,Arial,${fs},&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,1,0,1,6,0,2,60,60,${marginV},1
Style: Sign,Arial,${Math.round(fs * 0.8)},&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,4,1,2,80,80,${Math.round(height * 0.1)},1
${graphicStyles(height).filter((l) => l.startsWith("Style: Tag")).join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const lines = [];
  for (const s of scenes || []) {
    if (s.lower_third) lines.push(...lowerThirdEvents(s.lower_third, Number(s.start_ms) || 0, Number(s.end_ms) || 0, width, height, colors));
    const narration = String(s.voiceover_text || "").trim();
    // A motion-graphic beat carries its own words on screen; with captions
    // off the track carries only name tags.
    if (s.graphic || !captions) continue;
    if (narration) {
      for (const c of chunkUgcCaptions(narration, Number(s.start_ms) || 0, Number(s.end_ms) || 0)) {
        lines.push(`Dialogue: 0,${msToAss(c.start_ms)},${msToAss(c.end_ms)},Ugc,,0,0,0,,${assEscape(c.text).toUpperCase()}`);
      }
    } else if (s.on_screen_text && String(s.on_screen_text).trim()) {
      lines.push(`Dialogue: 0,${msToAss(s.start_ms)},${msToAss(s.end_ms)},Sign,,0,0,0,,${assEscape(s.on_screen_text)}`);
    }
  }
  return `${header}\n${lines.join("\n")}\n`;
}

function fmtDims(fmt) {
  const f = String(fmt || "").replace("x", ":");
  return f === "9:16" ? [1080, 1920] : f === "16:9" ? [1920, 1080] : [1080, 1080];
}

// One scene-aware motion clip from a still, output at target size/fps.
// 1.5x supersample (max zoom is 1.18, so headroom to spare) + ultrafast preset:
// the intermediate clips are re-encoded in the assemble pass, so cheap here is
// free quality-wise and keeps render times sane on a single shared vCPU.
async function stillMotionClip(img, outPath, durSec, w, h, treatment = "push_in") {
  const { frames, filter: vf } = buildStillMotionFilter(treatment, durSec, w, h);
  // The still goes in as a SINGLE frame; zoompan's d= then emits exactly
  // `frames` output frames from it. (Looping the input first multiplies the
  // output by d per duplicated input frame — hours of video per clip.)
  await runFfmpeg([
    "-y", "-i", img, "-vf", vf, "-frames:v", String(frames),
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", outPath,
  ]);
}

// Premium clips already contain generated motion. Normalize their framing and
// duration only; missing Premium clips are rejected by the Premium assembly
// branch instead of being replaced with still-image motion.
async function premiumMotionClip(videoSrc, outPath, durSec, w, h) {
  const vf = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},fps=30,` +
    `tpad=stop_mode=clone:stop_duration=${durSec.toFixed(3)},trim=0:${durSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v]`;
  await runFfmpeg([
    "-y", "-stream_loop", "-1", "-i", videoSrc,
    "-filter_complex", vf, "-map", "[v]", "-an", "-t", durSec.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", outPath,
  ]);
}

// One clip from real stock footage: cover-crop to target, 30fps, freeze-pad the
// last frame if the source runs short, hard-cap at the scene duration.
async function stockClip(src, outPath, durSec, w, h) {
  const vf =
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},` +
    `fps=30,tpad=stop_mode=clone:stop_duration=${durSec.toFixed(3)},setsar=1,format=yuv420p`;
  await runFfmpeg([
    "-y", "-i", src, "-vf", vf, "-t", durSec.toFixed(3),
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", outPath,
  ]);
}

// ---- UGC scene clips: each carries its own narration so the timeline is a
// plain hard-cut concat (no crossfades — creators cut, they don't dissolve).
// Narration that overruns its scene is sped up (video too, for talking heads,
// so lips stay in sync) up to a small limit; beyond that the script is wrong
// and the job fails with the scene named instead of shipping a clipped line.
const UGC_MAX_TEMPO = 1.25;

async function ugcFitTempo(audioPath, durSec, idx) {
  if (!audioPath) return 1;
  const voSec = await probeDuration(audioPath);
  if (!Number.isFinite(voSec) || voSec <= durSec * 1.03) return 1;
  const tempo = voSec / durSec;
  if (tempo > UGC_MAX_TEMPO) {
    throw new Error(`scene ${idx} narration runs ${voSec.toFixed(1)}s in a ${durSec.toFixed(1)}s scene — shorten the script for that scene`);
  }
  return tempo;
}

function ugcAudioChain(tempo, durSec) {
  const speed = tempo > 1.001 ? `atempo=${tempo.toFixed(4)},` : "";
  return `${speed}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${durSec.toFixed(3)},asetpts=N/SR/TB`;
}

// Talking head: the S2V clip cover-cropped to the frame, frozen on its last
// frame if the model came up short, cut to the scene. Audio is the per-scene
// narration (the clip's own track if the coordinator sent none).
async function ugcTalkingClip(videoSrc, audioSrc, outPath, durSec, w, h, idx) {
  const tempo = await ugcFitTempo(audioSrc, durSec, idx);
  const args = ["-y", "-i", videoSrc];
  if (audioSrc) args.push("-i", audioSrc);
  const speed = tempo > 1.001 ? `setpts=PTS/${tempo.toFixed(4)},` : "";
  const v = `[0:v]${speed}scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},fps=30,` +
    `tpad=stop_mode=clone:stop_duration=${durSec.toFixed(3)},trim=0:${durSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v]`;
  const a = `[${audioSrc ? 1 : 0}:a]${ugcAudioChain(tempo, durSec)}[a]`;
  args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-t", durSec.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", outPath);
  await runFfmpeg(args);
}

// Product b-roll. The coordinator sends a Wan motion clip (videoSrc) for every
// b-roll shot; Wan caps at ~5s, so a clip shorter than its scene is slowed
// (up to 1.8x) to fill it rather than frozen on the last frame. The Ken-Burns
// still path remains only for the logo end-card (and older payloads).
const UGC_MAX_SLOWDOWN = 1.8;

async function ugcBrollClip(img, audioSrc, outPath, durSec, w, h, idx, videoSrc = null) {
  const tempo = await ugcFitTempo(audioSrc, durSec, idx);
  const frames = Math.max(2, Math.round(durSec * 30));
  const zi = Math.round((w * 1.5) / 2) * 2, hi = Math.round((h * 1.5) / 2) * 2;
  const args = ["-y", "-i", videoSrc || img];
  if (audioSrc) args.push("-i", audioSrc);
  let v;
  if (videoSrc) {
    const vidSec = await probeDuration(videoSrc);
    const stretch = Number.isFinite(vidSec) && vidSec > 0.2 && vidSec < durSec ? Math.min(UGC_MAX_SLOWDOWN, durSec / vidSec) : 1;
    const slow = stretch > 1.001 ? `setpts=PTS*${stretch.toFixed(4)},` : "";
    v = `[0:v]${slow}scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},fps=30,` +
      `tpad=stop_mode=clone:stop_duration=${durSec.toFixed(3)},trim=0:${durSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v]`;
  } else {
    v = `[0:v]scale=${zi}:${hi}:force_original_aspect_ratio=increase,crop=${zi}:${hi},` +
      `zoompan=z='min(zoom+0.0028,1.26)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30,setsar=1,format=yuv420p[v]`;
  }
  const a = audioSrc
    ? `[1:a]${ugcAudioChain(tempo, durSec)}[a]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${durSec.toFixed(3)},asetpts=N/SR/TB[a]`;
  args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-frames:v", String(frames), "-t", durSec.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", outPath);
  await runFfmpeg(args);
}

// Motion-graphic beat (TWIN founder ads): headline and points animate in over
// the brand's dark backdrop, drawn by libass so the words are exact. Carries
// the scene's narration like every other UGC clip.
async function ugcGraphicClip(graphic, colors, audioSrc, outPath, durSec, w, h, idx, dir) {
  const tempo = await ugcFitTempo(audioSrc, durSec, idx);
  // EffectCraft first (Onixus mark reveal, designed type motion); the libass
  // graphic below stays as the fallback so a failed render never drops a beat.
  const ecOut = join(dir, `graphic-ec-${idx}.mp4`);
  const ec = await renderBrandBeat(graphic, ecOut, { w, h, durSec, dir, idx, colors });
  let ecError = ec.error;
  if (ec.ok) {
    console.log(`[ugc] scene ${idx} graphic rendered by EffectCraft in ${ec.ms}ms${ec.warn?.length ? ` (warn: ${ec.warn.join("; ")})` : ""}`);
    const frames = Math.max(2, Math.round(durSec * 30));
    const args = ["-y", "-i", ecOut];
    if (audioSrc) args.push("-i", audioSrc);
    const v = `[0:v]fps=30,scale=${w}:${h},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=1[v]`;
    const a = audioSrc
      ? `[1:a]${ugcAudioChain(tempo, durSec)}[a]`
      : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${durSec.toFixed(3)},asetpts=N/SR/TB[a]`;
    args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-frames:v", String(frames), "-t", durSec.toFixed(3),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", "-b:a", "160k", outPath);
    try {
      await runFfmpeg(args);
      return;
    } catch (e) {
      ecError = `mux failed: ${e.message}`;
    }
  }
  if (effectcraftCli()) console.warn(`[ugc] scene ${idx} EffectCraft graphic failed, using libass: ${ecError}`);
  const ass = buildGraphicAss(graphic, Math.round(durSec * 1000), w, h, colors, idx);
  if (!ass) throw new Error(`scene ${idx} motion graphic has no headline`);
  const assPath = join(dir, `graphic-${idx}.ass`);
  await writeFile(assPath, ass);
  const frames = Math.max(2, Math.round(durSec * 30));
  const args = ["-y", "-f", "lavfi", "-i", `color=c=${SITE_BG}:s=${w}x${h}:r=30:d=${durSec.toFixed(3)}`];
  if (audioSrc) args.push("-i", audioSrc);
  const v = `[0:v]subtitles=${assPath},setsar=1,format=yuv420p[v]`;
  const a = audioSrc
    ? `[1:a]${ugcAudioChain(tempo, durSec)}[a]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${durSec.toFixed(3)},asetpts=N/SR/TB[a]`;
  args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-frames:v", String(frames), "-t", durSec.toFixed(3),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", outPath);
  await runFfmpeg(args);
}

// Real website b-roll (TWIN founder ads): the captured page strip scrolls
// smoothly inside a rounded phone frame on the brand's dark backdrop, instead
// of a raw screenshot slapped full-frame between talking-head shots.
const SITE_BG = "0x04040F";
const SITE_BEZEL = "0x1C1C26";

async function roundedMask(path, w, h, r) {
  const R = Math.max(1, Math.min(r, Math.floor(Math.min(w, h) / 2) - 1));
  const expr = `255*lte(hypot(max(0,abs(X-(W-1)/2)-((W-1)/2-${R})),max(0,abs(Y-(H-1)/2)-((H-1)/2-${R}))),${R})`;
  await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}`, "-frames:v", "1",
    "-vf", `format=gray,geq=lum='${expr}'`, path]);
}

async function siteScrollClip(img, audioSrc, outPath, durSec, w, h, idx, dir) {
  const tempo = await ugcFitTempo(audioSrc, durSec, idx);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const sw = even(w * 0.74);
  const sh = even(Math.min(h * 0.82, sw * (h / w) * 0.92));
  const pad = even(w * 0.018);
  const bw = sw + pad * 2, bh = sh + pad * 2;
  const screenMask = join(dir, `mask-screen-${idx}.png`);
  const bodyMask = join(dir, `mask-body-${idx}.png`);
  await roundedMask(screenMask, sw, sh, Math.round(sw * 0.07));
  await roundedMask(bodyMask, bw, bh, Math.round(sw * 0.07) + pad);
  const D = durSec.toFixed(3);
  // Ease-in-out scroll from the top of the strip to its bottom over the shot.
  const ease = `(0.5-0.5*cos(PI*min(t/${D},1)))`;
  const args = ["-y",
    "-f", "lavfi", "-i", `color=c=${SITE_BG}:s=${w}x${h}:r=30:d=${D}`,
    "-f", "lavfi", "-i", `color=c=${SITE_BEZEL}:s=${bw}x${bh}:r=30:d=${D}`,
    "-loop", "1", "-framerate", "30", "-t", D, "-i", img,
    "-loop", "1", "-framerate", "30", "-t", D, "-i", screenMask,
    "-loop", "1", "-framerate", "30", "-t", D, "-i", bodyMask,
  ];
  if (audioSrc) args.push("-i", audioSrc);
  const ox = Math.round((w - bw) / 2), oy = Math.round((h - bh) / 2);
  const v = [
    `[2:v]scale=${sw}:-2,pad=${sw}:'max(ih,${sh})':0:0:color=white,crop=${sw}:${sh}:0:'(ih-oh)*${ease}',format=rgba[scr]`,
    `[3:v]format=gray[sm]`, `[scr][sm]alphamerge[scrm]`,
    `[4:v]format=gray[bm]`, `[1:v]format=rgba[body]`, `[body][bm]alphamerge[bodym]`,
    `[0:v][bodym]overlay=${ox}:${oy}[b1]`,
    `[b1][scrm]overlay=${ox + pad}:${oy + pad}:shortest=1,setsar=1,format=yuv420p[v]`,
  ].join(";");
  const a = audioSrc
    ? `[5:a]${ugcAudioChain(tempo, durSec)}[a]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${D},asetpts=N/SR/TB[a]`;
  args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-t", D,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", outPath);
  await runFfmpeg(args);
}

// Hard-cut concat of self-contained scene clips, then logo, captions and a
// low music bed under the creator's voice.
async function ugcAssemble(clips, outPath, w, h, musicPath, assPath, logoPath, total, duckDb) {
  const n = clips.length;
  const args = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  const musicIdx = musicPath ? n : null;
  if (musicPath) args.push("-i", musicPath);
  const logoIdx = logoPath ? n + (musicPath ? 1 : 0) : null;
  if (logoPath) args.push("-i", logoPath);
  const fc = [];
  fc.push(`${clips.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${n}:v=1:a=1[vcat][acat]`);
  let last = "vcat";
  if (logoIdx != null) {
    const lw = Math.round(w * 0.14), m = Math.round(w * 0.04);
    fc.push(`[${logoIdx}:v]scale=${lw}:-1[lg]`, `[${last}][lg]overlay=x=W-w-${m}:y=${m}:format=auto[vlogo]`);
    last = "vlogo";
  }
  if (assPath) { fc.push(`[${last}]subtitles=${assPath}[vout]`); last = "vout"; }
  let aout = "acat";
  if (musicIdx != null) {
    // Creators talk over quiet music: duck deeper than the cinematic default.
    const duckLinear = Number.isFinite(duckDb) ? Math.max(0.02, Math.min(1, Math.pow(10, duckDb / 20))) : 0.14;
    const fadeSt = Math.max(0, total - 1.5).toFixed(3);
    fc.push(`[${musicIdx}:a]volume=${duckLinear.toFixed(3)},afade=t=out:st=${fadeSt}:d=1.5[ma]`);
    fc.push(`[acat][ma]amix=inputs=2:duration=first:normalize=0[aout]`);
    aout = "aout";
  }
  args.push("-filter_complex", fc.join(";"), "-map", `[${last}]`, "-map", `[${aout}]`, "-t", total.toFixed(3),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", outPath);
  await runFfmpeg(args);
}

// Audio graph shared by both render paths. Voiceover is mixed at full level with
// music ducked underneath (music alone plays near-full); music always fades out
// over the last 1.5s. Returns the label to map, or null for voice-only/none.
function buildAudioGraph(fc, { voiceIdx, musicIdx, total }) {
  const fadeSt = Math.max(0, total - 1.5).toFixed(3);
  if (voiceIdx != null && musicIdx != null) {
    fc.push(`[${voiceIdx}:a]apad[va]`);
    fc.push(`[${musicIdx}:a]volume=0.22,afade=t=out:st=${fadeSt}:d=1.5[ma]`);
    fc.push(`[va][ma]amix=inputs=2:duration=longest:normalize=0[aout]`);
    return "aout";
  }
  if (musicIdx != null) {
    fc.push(`[${musicIdx}:a]volume=0.85,afade=t=out:st=${fadeSt}:d=1.5[aout]`);
    return "aout";
  }
  return null;
}

// Join scene clips with restrained transitions; optionally brand-logo watermark, burned
// captions, and voiceover/music mux.
async function xfadeAssemble(clips, durs, outPath, w, h, voicePath, musicPath, assPath, logoPath, transitionPlan = []) {
  const n = clips.length;
  const args = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  const voiceIdx = voicePath ? n : null;
  if (voicePath) args.push("-i", voicePath);
  const musicIdx = musicPath ? n + (voicePath ? 1 : 0) : null;
  if (musicPath) args.push("-i", musicPath);
  const logoIdx = logoPath ? n + (voicePath ? 1 : 0) + (musicPath ? 1 : 0) : null;
  if (logoPath) args.push("-i", logoPath);

  const fc = [];
  const norm = (label, out) => `${label}settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=yuv420p[${out}]`;
  const inputLabels = clips.map((_, i) => `v${i}n`);
  clips.forEach((_, i) => fc.push(norm(`[${i}:v]`, inputLabels[i])));

  let last = inputLabels[0] || "0:v";
  let total = durs[0] || 0;
  if (n > 1) {
    let acc = durs[0], prev = inputLabels[0];
    for (let k = 1; k < n; k++) {
      const out = `vx${k}`;
      const raw = `vr${k}`;
      const transition = normalizeTransitionIntent(transitionPlan[k - 1]?.transition) || "fade";
      const T = Math.max(0, Number(transitionPlan[k - 1]?.duration_sec) || 0);
      if (transition === "cut" || T <= 0) {
        fc.push(`[${prev}][${inputLabels[k]}]concat=n=2:v=1:a=0[${raw}]`);
        acc = acc + durs[k];
      } else {
        const off = Math.max(0, acc - T);
        fc.push(`[${prev}][${inputLabels[k]}]xfade=transition=${transition}:duration=${T.toFixed(3)}:offset=${off.toFixed(3)}[${raw}]`);
        acc = acc + durs[k] - T;
      }
      fc.push(norm(`[${raw}]`, out));
      prev = out;
    }
    total = acc;
    last = prev;
  }
  if (logoIdx != null) {
    const lw = Math.round(w * 0.14), m = Math.round(w * 0.04);
    fc.push(`[${logoIdx}:v]scale=${lw}:-1[lg]`);
    fc.push(`[${last}][lg]overlay=x=W-w-${m}:y=${m}:format=auto[vlogo]`);
    last = "vlogo";
  }
  let voutIsLabel = last !== "0:v";
  let vout = last;
  if (assPath) { fc.push(`[${last}]subtitles=${assPath}[vout]`); vout = "vout"; voutIsLabel = true; }

  // Explicit -t instead of -shortest: a voiceover shorter than the video must
  // not truncate it (music/silence covers the tail); longer audio gets cut here.
  const aout = buildAudioGraph(fc, { voiceIdx, musicIdx, total });

  if (fc.length) args.push("-filter_complex", fc.join(";"));
  args.push("-map", voutIsLabel ? `[${vout}]` : vout);
  if (aout) args.push("-map", `[${aout}]`, "-c:a", "aac", "-b:a", "128k");
  else if (voiceIdx != null) args.push("-map", `${voiceIdx}:a`, "-c:a", "aac", "-b:a", "128k");
  args.push("-t", total.toFixed(3));
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "22", outPath);
  await runFfmpeg(args);
}

function runFfmpeg(args, timeoutMs = TIMEOUTS.ffmpeg_ms) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, timeoutMs);
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`ffmpeg killed after ${Math.round(timeoutMs / 1000)}s: ${stderr.slice(-300)}`));
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

// ffprobe with a hard cap; ffprobe on a truncated/corrupt file can hang.
function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, args);
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, TIMEOUTS.ffprobe_ms);
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("ffprobe timed out"));
      if (code !== 0) return reject(new Error("ffprobe failed"));
      resolve(out);
    });
  });
}

async function probeDuration(file) {
  const out = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
  const n = Number(out.trim());
  if (!Number.isFinite(n)) throw new Error("ffprobe non-numeric");
  return n;
}

async function probeHasAudio(file) {
  const out = await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return Boolean(out.trim());
}

// Correct modest TTS pacing drift so narration reaches the end of the content.
// Drastically short scripts fail rather than publishing a long silent tail.
async function fitVoiceoverToTimeline(dir, voicePath, totalSec) {
  const originalSec = await probeDuration(voicePath);
  const { coverage, adjust, tempo } = voiceoverFitPlan(originalSec, totalSec);
  if (!adjust) return { path: voicePath, originalSec, adjustedSec: originalSec, adjusted: false, coverage };
  const fittedPath = join(dir, "voice-fitted.mp3");
  await runFfmpeg([
    "-y", "-i", voicePath,
    "-filter:a", `atempo=${tempo.toFixed(5)},apad,atrim=0:${totalSec.toFixed(3)}`,
    "-c:a", "libmp3lame", "-b:a", "160k", fittedPath,
  ]);
  const adjustedSec = await probeDuration(fittedPath);
  return { path: fittedPath, originalSec, adjustedSec, adjusted: true, coverage };
}

function auth(req, res, next) {
  const h = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!RENDER_TOKEN || h !== RENDER_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function htmlAuth(req, res, next) {
  if (!HTML_RENDER_TOKEN) return next(); // no token configured -> open, same as before
  const h = String(req.headers["x-render-token"] || "").trim();
  if (h !== HTML_RENDER_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// One shared headless Chromium instance, launched lazily on first use and
// reused across requests (each request gets its own page/tab). Relaunches
// automatically if the browser process ever dies.
let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.connected) return existing;
    browserPromise = null;
  }
  browserPromise = puppeteer
    .launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

// Cheap existence/version check, not a full browser launch — health checks
// may be polled often and shouldn't pay Chromium's ~1-2s startup cost.
function hasChromium() {
  return new Promise((resolve) => {
    const p = spawn(CHROMIUM_PATH, ["--version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function countByStatus(status) {
  let n = 0;
  for (const j of jobs.values()) if (j.status === status) n++;
  return n;
}

async function reportStatus(jobId, projectId, patch, attemptToken = null) {
  if (!STATUS_ENDPOINT) {
    console.error(`[job ${jobId}] status endpoint not configured`);
    return false;
  }
  const result = await deliverRenderStatus(STATUS_ENDPOINT, RENDER_TOKEN,
    { job_id: jobId, project_id: projectId, attempt_token: attemptToken, patch }, {
      fetcher: (url, options) => fetchWithTimeout(url, options, TIMEOUTS.status_ms),
    });
  if (!result.ok) console.error(`[job ${jobId}] callback undelivered after ${result.attempts} attempts: ${result.error}`);
  return result.ok;
}

function validateVideoPayload(p) {
  if (!p?.job_id || !p?.project_id) return "missing job_id or project_id";
  if (!p?.upload_tokens?.video?.signed_url || !p?.upload_tokens?.video?.token) {
    return "missing upload_tokens.video (signed_url + token)";
  }
  if (!p?.upload_tokens?.thumbnail?.signed_url || !p?.upload_tokens?.thumbnail?.token) {
    return "missing upload_tokens.thumbnail (signed_url + token)";
  }
  if (!Array.isArray(p.scenes) || p.scenes.length !== p.expected_scene_count) {
    return "scene count mismatch";
  }
  if (!p?.brand?.logo_url) return "missing required brand logo_url";
  if (p.scenes.some((s) => !s?.image_url && !s?.video_url)) return "one or more scenes missing image_url/video_url";
  return null;
}

app.get("/health", async (_req, res) => {
  const [ffmpegOk, chromiumOk, templates] = await Promise.all([hasFfmpeg(), hasChromium(), listTemplates()]);
  res.json({
    ok: true,
    // /render needs Chromium AND the templates directory shipped in the image.
    static_render: Boolean(chromiumOk && RENDER_TOKEN && templates.length > 0),
    templates,
    video_render: Boolean(ffmpegOk && RENDER_TOKEN),
    ad_adaptation: 1,
    callback_protocol: 2,
    motion_graphics: effectcraftCli() ? "effectcraft" : "libass",
    html_render: chromiumOk,
    html_render_auth_required: Boolean(HTML_RENDER_TOKEN),
    html_render_max_concurrency: MAX_HTML_CONCURRENCY,
    html_render_active: pageSlots.active,
    status_endpoint_configured: Boolean(STATUS_ENDPOINT),
    undelivered_video_callbacks: countByStatus("callback_pending"),
    active_video_jobs: countByStatus("rendering"),
    queued_video_jobs: countByStatus("queued"),
  });
});

async function listTemplates() {
  try {
    const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory() && existsSync(join(TEMPLATES_DIR, d.name, "index.html"))).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

app.get("/templates", auth, async (_req, res) => {
  res.json({ templates: await listTemplates() });
});

// Template -> branded PNG/JPEG. Called by the signal-render-template and
// signal-render-carousel edge functions with { template, params } and bearer
// RENDER_TOKEN. Templates read params from the query string, load their own
// fonts/logos, and flip body.dataset.ready="1" (+ dataset.imgStatus) when done.
app.post("/render", auth, async (req, res) => {
  const { template = "master", width = 1080, height = 1080, format = "png", params = {}, strictLogos } = req.body || {};
  const safeName = String(template).replace(/[^a-zA-Z0-9_-]/g, "");
  const templateFile = join(TEMPLATES_DIR, safeName, "index.html");
  if (!safeName || !existsSync(templateFile)) {
    return res.status(404).json({ error: `template not found: ${safeName}` });
  }
  if (params && typeof params !== "object") return res.status(400).json({ error: "params must be an object" });

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) qs.set(key, String(value));
  }
  const fileUrl = `${pathToFileURL(templateFile).href}?${qs.toString()}`;
  const w = Math.max(1, Math.min(4000, Math.round(Number(width) || 1080)));
  const h = Math.max(1, Math.min(4000, Math.round(Number(height) || 1080)));
  const type = format === "jpeg" || format === "jpg" ? "jpeg" : "png";

  let page = null;
  await pageSlots.acquire();
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.goto(fileUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUTS.html_render_ms });

    try {
      await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: TIMEOUTS.html_render_ms });
    } catch {
      return res.status(504).json({ error: "render timed out waiting for assets (logo/font may be unreachable)" });
    }

    const imgStatus = await page.evaluate(() => {
      try { return JSON.parse(document.body.dataset.imgStatus || "{}"); } catch { return {}; }
    });
    const failed = Object.entries(imgStatus).filter(([, v]) => v === "fail").map(([k]) => k);
    if (strictLogos !== false && failed.length) {
      return res.status(422).json({
        error: "image(s) failed to load",
        failed,
        imgStatus,
        hint: "check the signed URL(s); post was NOT rendered to avoid a broken image",
      });
    }

    await new Promise((r) => setTimeout(r, 150));
    const el = (await page.$(".canvas")) || page;
    const buffer = await el.screenshot({ type, ...(type === "jpeg" ? { quality: 92 } : {}) });
    res.setHeader("Content-Type", type === "png" ? "image/png" : "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Img-Status", JSON.stringify(imgStatus));
    // puppeteer >= 22 returns a Uint8Array; express would JSON-serialize that.
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("[render] failed:", err);
    res.status(500).json({ error: "render_failed", message: String(err?.message || err).slice(0, 300) });
  } finally {
    if (page) await page.close().catch(() => {});
    pageSlots.release();
  }
});

// HTML/CSS -> PNG (or JPEG) rendering, e.g. for social-post stills built from
// a template. Replaces the previous dependency on the free pageshot.site API,
// which was failing under its own load (timeouts and 503 SERVER_BUSY) —
// see TWIN workflow debugging, Sep 2026.
app.post("/render-html", htmlAuth, async (req, res) => {
  const { html, width, height, format, device_scale } = req.body || {};
  if (typeof html !== "string" || !html.trim()) {
    return res.status(400).json({ error: "missing html (string) in body" });
  }
  if (html.length > 2_000_000) {
    return res.status(400).json({ error: "html payload too large (max 2MB)" });
  }
  const w = Math.max(1, Math.min(4000, Math.round(Number(width) || 1080)));
  const h = Math.max(1, Math.min(4000, Math.round(Number(height) || 1080)));
  const scale = Math.max(1, Math.min(3, Number(device_scale) || 1));
  const type = format === "jpeg" || format === "jpg" ? "jpeg" : "png";

  let page = null;
  await pageSlots.acquire();
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
    // networkidle0: template pulls in Google Fonts via @import and remote
    // <img> URLs (Supabase-hosted bot art) — wait for those to settle before
    // screenshotting rather than racing a fixed delay.
    await page.setContent(html, { waitUntil: "networkidle0", timeout: TIMEOUTS.html_render_ms });
    const buffer = await page.screenshot({
      type,
      ...(type === "jpeg" ? { quality: 90 } : {}),
    });
    res.setHeader("Content-Type", type === "png" ? "image/png" : "image/jpeg");
    // puppeteer >= 22 returns a Uint8Array; express would JSON-serialize that.
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("render-html failed:", err);
    res.status(500).json({
      error: "render_failed",
      message: String(err?.message || err).slice(0, 300),
    });
  } finally {
    if (page) await page.close().catch(() => {});
    pageSlots.release();
  }
});

// Real website -> PNG/JPEG. Used for b-roll that shows the actual product
// (TWIN UGC ads screen-record onixus.xyz rather than inventing a UI). Bearer
// RENDER_TOKEN, and only allowlisted hosts — see site-capture.js for why.
app.post("/screenshot-url", auth, async (req, res) => {
  const target = allowedCaptureUrl(req.body?.url, SCREENSHOT_HOSTS);
  if (!target) {
    return res.status(400).json({ error: "url must be https on an allowed host", allowed_hosts: SCREENSHOT_HOSTS });
  }
  const o = captureOptions(req.body || {});

  let page = null;
  await pageSlots.acquire();
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: o.width, height: o.height, deviceScaleFactor: o.deviceScale, isMobile: o.mobile, hasTouch: o.mobile });
    // Block any top-level navigation (redirects, meta refresh, JS location
    // changes) that leaves the allowlist. Subresources — fonts, CDN images —
    // still load so the page renders as visitors see it.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame() && !allowedCaptureUrl(r.url(), SCREENSHOT_HOSTS)) {
        r.abort("blockedbyclient").catch(() => {});
      } else {
        r.continue().catch(() => {});
      }
    });
    await page.goto(target, { waitUntil: "networkidle2", timeout: TIMEOUTS.html_render_ms });
    if (!allowedCaptureUrl(page.url(), SCREENSHOT_HOSTS)) {
      return res.status(400).json({ error: "page left the allowed hosts", final_url: page.url() });
    }
    const pageText = await page.evaluate(() => [document.title, document.body?.innerText ?? ""]);
    if (looksLikeBotChallenge(pageText[0], pageText[1])) {
      return res.status(502).json({ error: "bot_challenge_page", message: "site served a bot-check page instead of content" });
    }
    // Walk the page first (strips only) so lazy images and injected sections
    // have loaded and the layout is final before anything is measured.
    let docH = 0;
    if (o.stripScreens > 1) {
      docH = await page.evaluate(async (maxH) => {
        const step = Math.round(window.innerHeight / 2);
        for (let p = 0; p < Math.min(document.documentElement.scrollHeight, maxH); p += step) {
          window.scrollTo(0, p);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
        return document.documentElement.scrollHeight;
      }, o.height * 10);
      if (o.settleMs > 0) await new Promise((r) => setTimeout(r, o.settleMs));
    }
    // Start at the section that matches the spoken line, when one does.
    let startY = o.scrollY;
    let focusMatch = null;
    if (o.focusText) {
      const headings = await page.evaluate(() =>
        [...document.querySelectorAll("h1,h2,h3,h4,[role=heading]")]
          .map((el) => ({ text: (el.innerText || "").trim().slice(0, 200), top: el.getBoundingClientRect().top + window.scrollY }))
          .filter((h) => h.text));
      const picked = pickFocusOffset(headings, o.focusText, o.scrollY);
      startY = picked.y;
      focusMatch = picked.match;
    }
    let buffer;
    if (o.stripScreens > 1) {
      // Keep the start on the matched section; on a short page shorten the
      // strip (never below one screen) instead of sliding it back to the top.
      const { y, height } = stripWindow(startY, o.height, o.stripScreens, docH);
      // The first walk stops at 10 screens; walk the chosen window itself so a
      // section further down has loaded its lazy content too.
      await page.evaluate(async (from, to) => {
        const step = Math.round(window.innerHeight / 2);
        // Visit every half-screen stop, then the exact last screen.
        for (let p = from; p < to + step; p += step) {
          window.scrollTo(0, Math.min(p, to));
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      }, y, y + height - o.height);
      if (o.settleMs > 0) await new Promise((r) => setTimeout(r, Math.min(o.settleMs, 600)));
      buffer = await page.screenshot({
        type: o.type, ...(o.type === "jpeg" ? { quality: 90 } : {}),
        clip: { x: 0, y, width: o.width, height }, captureBeyondViewport: true,
      });
    } else {
      if (startY > 0) await page.evaluate((y) => window.scrollTo(0, y), startY);
      // Let scroll-triggered reveals and lazy images finish.
      if (o.settleMs > 0) await new Promise((r) => setTimeout(r, o.settleMs));
      buffer = await page.screenshot({ type: o.type, ...(o.type === "jpeg" ? { quality: 90 } : {}) });
    }
    res.setHeader("Content-Type", o.type === "png" ? "image/png" : "image/jpeg");
    res.setHeader("X-Final-Url", page.url());
    // Truncate before encoding so no percent-escape is cut in half.
    if (focusMatch) res.setHeader("X-Focus-Match", encodeURIComponent(focusMatch.slice(0, 100)));
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("screenshot-url failed:", err);
    res.status(500).json({ error: "capture_failed", message: String(err?.message || err).slice(0, 300) });
  } finally {
    if (page) await page.close().catch(() => {});
    pageSlots.release();
  }
});

// Renders run strictly one at a time — concurrent ffmpeg pipelines on a small
// shared vCPU just starve each other. Duplicate submissions of an in-flight
// job (UI retries) are acknowledged without enqueueing a second render.
let renderChain = Promise.resolve();

// Adapt an approved master without TTS, diffusion, extra logos, music or captions.
app.post('/adapt-ad', auth, (req,res)=>{
 const p=req.body;
 try{
  if(!/^[0-9a-f-]{36}$/.test(p?.variant_id)||!/^[0-9a-f-]{36}$/.test(p?.attempt_id)||!AD_CANVASES[p.format]||!SUPABASE_URL)throw new Error('Invalid adaptation request');
  adaptationUrl(p.source_url,SUPABASE_URL);
  adaptationUrl(p.upload?.video,SUPABASE_URL,true);adaptationUrl(p.upload?.thumbnail,SUPABASE_URL,true);
 }catch(e){return res.status(400).json({error:e.message});}
 const key='adapt:'+p.attempt_id;
 if(jobs.has(key))return res.status(202).json({ok:true,deduped:true});
 jobs.set(key,{status:'queued'});res.status(202).json({ok:true,model_calls:0});
 renderChain=renderChain.catch(()=>{}).then(async()=>{
  jobs.set(key,{status:'rendering'});
  const dir=await mkdtemp(join(tmpdir(),'ad-adapt-'));
  const report=async(body)=>{
   const r=await fetchWithTimeout(SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/signal-ad-variants',{method:'POST',headers:{Authorization:'Bearer '+RENDER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({action:'complete',variant_id:p.variant_id,attempt_id:p.attempt_id,client_id:p.client_id,...body})},30000);
   if(!r.ok)throw new Error('Adaptation callback '+r.status);
  };
  try{
   const r=await fetchWithTimeout(p.source_url,{},TIMEOUTS.download_ms);if(!r.ok)throw new Error('Master download failed');
   if(Number(r.headers.get('content-length'))>200000000)throw new Error('Master exceeds adaptation size limit');
   const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>200000000)throw new Error('Master exceeds adaptation size limit');
   const source=join(dir,'master.mp4'),out=join(dir,'export.mp4'),thumb=join(dir,'thumb.jpg');await writeFile(source,bytes);
   await runFfmpeg(adaptationArgs(source,out,p.format));
   const duration=await probeDuration(out);
   if(!Number.isFinite(p.duration_sec)||Math.abs(duration-p.duration_sec)>1.5)throw new Error('Adaptation changed master duration');
   if(await probeHasAudio(source)&&!await probeHasAudio(out))throw new Error('Adaptation lost approved audio');
   await runFfmpeg(['-y','-i',out,'-frames:v','1','-q:v','2',thumb]);
   await putSigned(p.upload.video,await readFile(out),'video/mp4');await putSigned(p.upload.thumbnail,await readFile(thumb),'image/jpeg');
   const [width,height]=AD_CANVASES[p.format];
   await report({status:'rendered',output_path:p.output_path,thumbnail_path:p.thumbnail_path,duration_sec:duration,width,height});
   jobs.set(key,{status:'done',finished_at:Date.now()});
  }catch(e){await report({status:'failed',error:String(e.message).slice(0,500)}).catch(()=>{});jobs.set(key,{status:'failed',finished_at:Date.now()});}
  finally{await rm(dir,{recursive:true,force:true});}
 }).catch(e=>console.error('Adaptation pipeline failed',e.message));
});

app.post("/render-video", auth, (req, res) => {
  const payload = req.body;
  const err = validateVideoPayload(payload);
  if (err) return res.status(400).json({ error: err });

  const existing = jobs.get(payload.job_id);
  if (existing && (existing.status === "queued" || existing.status === "rendering")) {
    if ((existing.attempt_token ?? null) !== (payload.attempt_token ?? null)) {
      return res.status(409).json({ error: "A different attempt is still running; reconcile it before retrying" });
    }
    return res.status(202).json({ ok: true, accepted: true, job_id: payload.job_id, deduped: true });
  }

  jobs.set(payload.job_id, { status: "queued", attempt_token: payload.attempt_token ?? null });
  res.status(202).json({ ok: true, accepted: true, job_id: payload.job_id });

  renderChain = renderChain
    .catch(() => {})
    .then(() => processVideoJob(payload))
    .catch((err) => {
      console.error(`[job ${payload.job_id}] fatal`, err);
    });
});

async function processVideoJob(p) {
  const { job_id: jobId, project_id: projectId } = p;
  const report = (patch) => reportStatus(jobId, projectId, patch, p.attempt_token ?? null);
  const isPremiumMotion = p.premium_motion === true;
  jobs.set(jobId, { status: "rendering", attempt_token: p.attempt_token ?? null });
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), `sig-${jobId}-`));

  try {
    await report({ status: "rendering", progress: 5, current_step: "downloading_scenes" });

    // 1. Download scenes (sorted by idx). Every scene has a still (used for the
    // thumbnail and as Ken-Burns source/fallback); stock scenes also carry a
    // video_url whose download failure quietly demotes them back to stills.
    const sorted = [...p.scenes].sort((a, b) => a.idx - b.idx);
    const scenePaths = [];
    for (const s of sorted) {
      const r = await fetchWithTimeout(s.image_url);
      if (!r.ok) throw new Error(`scene ${s.idx} download ${r.status}`);
      const file = join(dir, `scene-${s.idx}.jpg`);
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
      let videoFile = null;
      if (s.video_url && (isPremiumMotion || p.render_style === "ugc")) {
        const vr = await fetchWithTimeout(s.video_url);
        if (!vr.ok) throw new Error(`scene ${s.idx} generated motion clip download ${vr.status}`);
        videoFile = join(dir, `scene-${s.idx}.mp4`);
        await writeFile(videoFile, Buffer.from(await vr.arrayBuffer()));
      } else if (s.video_url) {
        try {
          const vr = await fetchWithTimeout(s.video_url);
          if (vr.ok) { videoFile = join(dir, `scene-${s.idx}.mp4`); await writeFile(videoFile, Buffer.from(await vr.arrayBuffer())); }
          else console.warn(`[job ${jobId}] scene ${s.idx} stock video ${vr.status}; using still`);
        } catch (e) { console.warn(`[job ${jobId}] scene ${s.idx} stock fetch failed (${String(e?.message || e)}); using still`); }
      }
      scenePaths.push({ ...s, file, videoFile });
    }

    await report({ progress: 35, current_step: "encoding" });

    // Output dimensions from project format ("9:16" | "1:1" | "16:9",
    // tolerating "9x16"/"16x9"). cover-fit via increase + crop.
    const [width, height] = fmtDims(p.format);
    const durs = scenePaths.map((s) => Math.max(0.6, (s.end_ms - s.start_ms) / 1000));

    // --- shared: voiceover (coordinator TTS) + caption track ---
    // When audio is enabled, fail closed: publishing a silent substitute is worse
    // than surfacing a retryable render error.
    let voicePath = null;
    let voiceMeta = null;
    // UGC narration is per scene (scenes[].audio_url), not one track.
    const isUgc = p.render_style === "ugc";
    if (p.voiceover_enabled && !p.voiceover_url && !isUgc) {
      throw new Error("voiceover enabled but voiceover_url is missing");
    }
    if (p.voiceover_url) {
      try {
        const vr = await fetchWithTimeout(p.voiceover_url);
        if (vr.ok) { voicePath = join(dir, "voice.mp3"); await writeFile(voicePath, Buffer.from(await vr.arrayBuffer())); }
        else throw new Error(`voiceover download ${vr.status}`);
      } catch (e) {
        if (p.voiceover_enabled) throw new Error(`required voiceover fetch failed: ${String(e?.message || e)}`);
        console.warn(`[job ${jobId}] optional voiceover fetch failed (${String(e?.message || e)})`);
      }
    }
    if (voicePath) {
      voiceMeta = await fitVoiceoverToTimeline(dir, voicePath, durs.reduce((a, b) => a + b, 0));
      voicePath = voiceMeta.path;
    }
    let assPath = null;
    // UGC captions are timed from the narration, so a narration-only scene
    // still needs the track.
    const captionSource = (s) => (isUgc ? s.voiceover_text || s.on_screen_text : s.on_screen_text);
    const wantCaptions = Boolean(p.captions_enabled && sorted.some((s) => captionSource(s) && String(captionSource(s)).trim()));
    // A UGC name tag is its own on-screen element: it needs the track even
    // when captions are off.
    const wantTags = isUgc && sorted.some((s) => s.lower_third);
    if (wantCaptions || wantTags) {
      assPath = join(dir, "captions.ass");
      await writeFile(assPath, isUgc ? buildUgcAss(sorted, width, height, p.brand?.colors ?? {}, { captions: wantCaptions }) : buildAss(sorted, width, height));
    }
    let musicPath = null;
    if (p.music_enabled !== false && !p.music_url) {
      throw new Error("music enabled but music_url is missing");
    }
    if (p.music_enabled !== false && p.music_url) {
      try {
        const mr = await fetchWithTimeout(p.music_url);
        if (mr.ok) { musicPath = join(dir, "music.mp3"); await writeFile(musicPath, Buffer.from(await mr.arrayBuffer())); }
        else throw new Error(`music download ${mr.status}`);
      } catch (e) {
        throw new Error(`required music fetch failed: ${String(e?.message || e)}`);
      }
    }
    // Brand logo watermark (best-effort; PNG alpha honored by overlay).
    let logoPath = null;
    if (p.brand?.logo_url) {
      try {
        const lr = await fetchWithTimeout(p.brand.logo_url);
        if (lr.ok) {
          const ct = String(lr.headers.get("content-type") || "");
          logoPath = join(dir, ct.includes("png") ? "logo.png" : "logo.img");
          await writeFile(logoPath, Buffer.from(await lr.arrayBuffer()));
        } else throw new Error(`required logo download ${lr.status}`);
      } catch (e) { throw new Error(`required brand logo fetch failed: ${String(e?.message || e)}`); }
    }

    const outPath = join(dir, "out.mp4");
    const coverVf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic,crop=${width}:${height},setsar=1`;

    // Fallback: the reliable timed slideshow (no motion), captions + audio muxed.
    async function renderSimple() {
      const listFile = join(dir, "concat.txt");
      const lines = [];
      for (const s of scenePaths) { lines.push(`file '${s.file}'`); lines.push(`duration ${(Math.max(0.6, (s.end_ms - s.start_ms) / 1000)).toFixed(3)}`); }
      lines.push(`file '${scenePaths[scenePaths.length - 1].file}'`);
      await writeFile(listFile, lines.join("\n") + "\n");
      const a = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
      const voiceIdx = voicePath ? 1 : null;
      if (voicePath) a.push("-i", voicePath);
      const musicIdx = musicPath ? 1 + (voicePath ? 1 : 0) : null;
      if (musicPath) a.push("-i", musicPath);
      const logoIdx = logoPath ? 1 + (voicePath ? 1 : 0) + (musicPath ? 1 : 0) : null;
      if (logoPath) a.push("-i", logoPath);
      const total = durs.reduce((x, y) => x + y, 0);
      const fc = [`[0:v]${coverVf},fps=30[vbase]`];
      let lastV = "vbase";
      if (logoIdx != null) {
        const lw = Math.round(width * 0.14), m = Math.round(width * 0.04);
        fc.push(`[${logoIdx}:v]scale=${lw}:-1[lg]`, `[${lastV}][lg]overlay=x=W-w-${m}:y=${m}:format=auto[vlogo]`);
        lastV = "vlogo";
      }
      if (assPath) { fc.push(`[${lastV}]subtitles=${assPath}[vout]`); lastV = "vout"; }
      else { fc.push(`[${lastV}]null[vout]`); lastV = "vout"; }
      const aout = buildAudioGraph(fc, { voiceIdx, musicIdx, total });
      a.push("-filter_complex", fc.join(";"), "-map", "[vout]");
      if (aout) a.push("-map", `[${aout}]`, "-c:a", "aac", "-b:a", "128k");
      else if (voiceIdx != null) a.push("-map", `${voiceIdx}:a`, "-c:a", "aac", "-b:a", "128k");
      a.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "22");
      a.push("-t", total.toFixed(3));
      a.push(outPath);
      await runFfmpeg(a);
    }

    // Cinematic: per-scene motion clips joined with restrained transitions. Falls back to
    // the simple path on any ffmpeg error so a render never fails outright.
    const requestedRenderStyle = "scene_aware_cinematic";
    let renderStyle = requestedRenderStyle;
    let motionPlan = [];
    let transitionPlan = [];
    let cinematicFallback = null;

    // UGC: creator on camera (S2V clips) hard-cut with product b-roll, each
    // scene carrying its own narration. No silent fallback to cinematic: a
    // pan over the creator's still is not a UGC ad, so the job fails with the
    // reason instead. B-roll without a clip (real site captures, the logo
    // end-card) gets a slow push-in on the still.
    if (isUgc) {
      await report({ progress: 40, current_step: "ugc_assemble" });
      const audioFiles = [];
      for (const s of scenePaths) {
        let af = null;
        if (s.audio_url) {
          const ar = await fetchWithTimeout(s.audio_url);
          if (!ar.ok) throw new Error(`scene ${s.idx} narration download ${ar.status}`);
          af = join(dir, `vo-${s.idx}.mp3`);
          await writeFile(af, Buffer.from(await ar.arrayBuffer()));
        }
        audioFiles.push(af);
      }
      // Fit scenes to the narration that was actually spoken: a line that
      // runs long gets a longer scene (captions follow), not a failed job.
      const voSecs = await Promise.all(audioFiles.map((f) => (f ? probeDuration(f) : NaN)));
      const stretched = ugcStretchDurations(durs, voSecs);
      if (stretched.some((d, i) => d !== durs[i])) {
        durs.splice(0, durs.length, ...stretched);
        const retimed = retimeScenes(sorted, durs);
        if (assPath) await writeFile(assPath, buildUgcAss(retimed, width, height, p.brand?.colors ?? {}, { captions: wantCaptions }));
        console.log(`[job ${jobId}] ugc scenes stretched to narration: ${durs.map((d) => d.toFixed(2)).join(", ")}s`);
      }
      const talkingMissing = scenePaths.filter((s) => s.shot === "talking_head" && !s.videoFile);
      if (talkingMissing.length) {
        throw new Error(`talking-head clip missing for scene ${talkingMissing.map((s) => s.idx).join(", ")}`);
      }
      const clips = [];
      for (let i = 0; i < scenePaths.length; i++) {
        const s = scenePaths[i];
        const cp = join(dir, `ugc-clip-${i}.mp4`);
        if (s.shot === "talking_head") {
          await ugcTalkingClip(s.videoFile, audioFiles[i], cp, durs[i], width, height, s.idx);
        } else if (s.graphic && !s.videoFile) {
          await ugcGraphicClip(s.graphic, p.brand?.colors ?? {}, audioFiles[i], cp, durs[i], width, height, s.idx, dir);
        } else if (s.site_capture && !s.videoFile) {
          await siteScrollClip(s.file, audioFiles[i], cp, durs[i], width, height, s.idx, dir);
        } else {
          await ugcBrollClip(s.file, audioFiles[i], cp, durs[i], width, height, s.idx, s.videoFile);
        }
        clips.push(cp);
      }
      const total = durs.reduce((a, b) => a + b, 0);
      await ugcAssemble(clips, outPath, width, height, musicPath, assPath, logoPath, total, Number(p.audio?.ducking?.duck_db));
      renderStyle = "ugc";
    }

    // Premium: generated per-scene motion clips joined with crossfades. This
    // branch has no slideshow fallback: a missing/broken clip must fail the
    // Premium job rather than masquerade as Standard.
    if (isPremiumMotion && !isUgc) {
      await report({ progress: 40, current_step: "premium_motion_assemble" });
      const missing = scenePaths.filter((s) => !s.videoFile && !s.endcard);
      if (missing.length) throw new Error(`Premium motion clips missing for scene ${missing.map((s) => s.idx).join(", ")}`);
      const T = Math.min(0.6, Math.min(...durs) * 0.4);
      const clipDurs = durs.map((d, i) => (i < durs.length - 1 ? d + T : d));
      const premiumTransitionPlan = scenePaths.slice(1).map(() => ({ transition: "fade", duration_sec: T }));
      const clips = [];
      for (let i = 0; i < scenePaths.length; i++) {
        const s = scenePaths[i];
        const cp = join(dir, `premium-clip-${i}.mp4`);
        if (s.videoFile) await premiumMotionClip(s.videoFile, cp, clipDurs[i], width, height);
        else await stillMotionClip(s.file, cp, clipDurs[i], width, height, "hold"); // explicit end-card only
        clips.push(cp);
      }
      await xfadeAssemble(clips, clipDurs, outPath, width, height, voicePath, musicPath, assPath, logoPath, premiumTransitionPlan);
      renderStyle = "premium_motion";
    }

    if (!isPremiumMotion && !isUgc) try {
      motionPlan = planMotionTreatments(scenePaths);
      transitionPlan = planTransitions(scenePaths).map((t, i) => ({
        ...t,
        duration_sec: transitionDuration(t.transition, Math.min(durs[i] || 0.6, durs[i + 1] || 0.6)),
      }));
      // Each transition overlaps adjacent clips by its duration, shortening the
      // timeline by that amount. Pad the outgoing clip by its own transition
      // duration so the assembled video still runs exactly the scene-sum
      // duration and captions remain aligned to original scene boundaries.
      const clipDurs = durs.map((d, i) => d + (transitionPlan[i]?.duration_sec || 0));
      const clips = [];
      for (let i = 0; i < scenePaths.length; i++) {
        const cp = join(dir, `clip-${i}.mp4`);
        if (scenePaths[i].videoFile) {
          try {
            await stockClip(scenePaths[i].videoFile, cp, clipDurs[i], width, height);
          } catch (e) {
            console.warn(`[job ${jobId}] scene ${scenePaths[i].idx} stock clip failed (${String(e?.message || e).slice(0, 120)}); still-motion fallback`);
            await stillMotionClip(scenePaths[i].file, cp, clipDurs[i], width, height, motionPlan[i]?.treatment);
          }
        } else {
          await stillMotionClip(scenePaths[i].file, cp, clipDurs[i], width, height, motionPlan[i]?.treatment);
        }
        clips.push(cp);
      }
      await xfadeAssemble(clips, clipDurs, outPath, width, height, voicePath, musicPath, assPath, logoPath, transitionPlan);
    } catch (err) {
      const reason = boundedDiagnostic(err?.message || err, 500);
      console.warn(`[job ${jobId}] cinematic render failed (${reason.slice(0, 200)}); falling back to slideshow`);
      renderStyle = "slideshow_fallback";
      cinematicFallback = {
        requested_render_style: requestedRenderStyle,
        actual_render_style: renderStyle,
        fallback_occurred: true,
        failure_stage: "cinematic_assembly",
        failure_reason: reason,
        motion_encoded: false,
        transitions_encoded: false,
      };
      await renderSimple();
    }
    console.log(`[job ${jobId}] render style: ${renderStyle}`);

    const hasAudio = await probeHasAudio(outPath);
    if ((p.voiceover_enabled || p.music_enabled) && !hasAudio) {
      throw new Error("final MP4 is missing the required audio stream");
    }

    // 4. Thumbnail from first scene
    const thumbPath = join(dir, "thumb.jpg");
    await runFfmpeg([
      "-y",
      "-i", scenePaths[0].file,
      "-vf", coverVf,
      "-q:v", "3",
      thumbPath,
    ]);

    await report({ progress: 80, current_step: "uploading" });

    // 5. Upload via signed PUTs
    const [videoBytes, thumbBytes] = await Promise.all([
      readFile(outPath),
      readFile(thumbPath),
    ]);
    await putSigned(
      p.upload_tokens.video.signed_url,
      videoBytes,
      p.upload_tokens.video.content_type || "video/mp4",
    );
    await putSigned(
      p.upload_tokens.thumbnail.signed_url,
      thumbBytes,
      p.upload_tokens.thumbnail.content_type || "image/jpeg",
    );

    // 6. Probe + terminal callback
    const [stV, stT, durationSec, version] = await Promise.all([
      stat(outPath),
      stat(thumbPath),
      probeDuration(outPath),
      ffmpegVersion(),
    ]);

    const completionDelivered = await report({
      status: "rendered",
      render_ms: Date.now() - started,
      render_source: p.render_source || "railway",
      duration_sec: durationSec,
      file_size_bytes: stV.size,
      output: {
        path: p.upload_tokens.video.path || p.output_path,
        size_bytes: stV.size,
        duration_sec: durationSec,
        content_type: "video/mp4",
      },
      thumbnail: {
        path: p.upload_tokens.thumbnail.path || p.thumbnail_path,
        size_bytes: stT.size,
        content_type: "image/jpeg",
      },
      has_audio: hasAudio,
      worker_meta: {
        ffmpeg_version: version,
        has_audio: hasAudio,
        voiceover_included: Boolean(voicePath),
        music_included: Boolean(musicPath),
        voiceover_original_sec: voiceMeta?.originalSec ?? null,
        voiceover_adjusted_sec: voiceMeta?.adjustedSec ?? null,
        voiceover_timing_adjusted: voiceMeta?.adjusted ?? false,
        voiceover_coverage_ratio: voiceMeta?.coverage ?? null,
        premium_motion: isPremiumMotion,
        premium_scene_count: isPremiumMotion ? scenePaths.filter((s) => Boolean(s.videoFile)).length : 0,
        premium_scene_indices: isPremiumMotion ? scenePaths.filter((s) => Boolean(s.videoFile)).map((s) => s.idx) : [],
        still_motion: {
          requested_render_style: requestedRenderStyle,
          render_style: renderStyle,
          actual_render_style: renderStyle,
          fallback_occurred: Boolean(cinematicFallback),
          motion_encoded: !cinematicFallback,
          transitions_encoded: !cinematicFallback,
          fallback: cinematicFallback,
          treatments: motionPlan.slice(0, 12),
          transitions: transitionPlan.slice(0, 12),
        },
      },
    });

    jobs.set(jobId, { status: completionDelivered ? "done" : "callback_pending", finished_at: Date.now() });
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500);
    console.error(`[job ${jobId}] failed:`, message);
    const failureDelivered = await report({
      status: "failed",
      error_reason: message,
      error: { code: "worker_error", message },
    });
    jobs.set(jobId, { status: failureDelivered ? "failed" : "callback_pending", finished_at: Date.now() });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function putSigned(url, bytes, contentType) {
  const r = await fetchWithTimeout(url, {
    method: "PUT",
    headers: { "x-upsert": "true", "Content-Type": contentType },
    body: bytes,
  }, TIMEOUTS.upload_ms);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`upload ${r.status}: ${body.slice(0, 200)}`);
  }
}

app.listen(PORT, () => {
  console.log(`signal-render worker listening on :${PORT} (status endpoint: ${STATUS_ENDPOINT || "unset"})`);
});


