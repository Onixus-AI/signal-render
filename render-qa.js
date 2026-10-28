// Render self-check (Omar, 2026-10-28). Twice a finished ad reached Omar with
// a problem nobody had looked at: a render from a stale worker (gradients he
// had already asked to remove) and posts that never published. After every
// render the worker now measures the file itself (black stretches, silence)
// and builds a contact sheet of frames across the whole ad, which Signal's
// vision review reads against the words the ad was meant to show.
import { spawn } from "node:child_process";

/** The commit this worker was built from (Railway sets it on Git deploys). */
export const WORKER_COMMIT = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 40) || null;

export const QA_TILES = 12;

/**
 * Times (seconds) to sample: spread across the ad, plus one near the end so
 * the end card is always checked. At most QA_TILES frames.
 */
export function qaSampleTimes(durationSec, tiles = QA_TILES) {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0.5) return [];
  const n = Math.max(2, Math.min(tiles, Math.round(d / 2.5)));
  const spread = Array.from({ length: n - 1 }, (_, i) => +((i + 0.5) * (d - 1) / (n - 1)).toFixed(2));
  return [...spread, +Math.max(0, d - 0.4).toFixed(2)];
}

/** Black stretches from ffmpeg blackdetect stderr. */
export function parseBlackdetect(stderr) {
  const out = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  let m;
  while ((m = re.exec(String(stderr || "")))) out.push({ start: +m[1], end: +m[2], sec: +m[3] });
  return out;
}

/** mean_volume (dB) from ffmpeg volumedetect stderr, or null. */
export function parseMeanVolume(stderr) {
  const m = String(stderr || "").match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  if (!m) return null;
  return m[1] === "-inf" ? -Infinity : +m[1];
}

/** Plain-language warnings from the measurements (never fatal). */
export function qaWarnings({ black = [], meanVolumeDb = null, hasAudio = true, durationSec = 0 }) {
  const w = [];
  for (const b of black) {
    // A short fade at the very start or end is normal.
    if (b.sec >= 0.8 && !(b.start < 0.3) && !(b.end > durationSec - 0.3)) w.push(`black screen for ${b.sec.toFixed(1)}s at ${b.start.toFixed(1)}s`);
  }
  if (hasAudio && meanVolumeDb !== null && meanVolumeDb < -38) w.push(`audio is almost silent (mean ${meanVolumeDb === -Infinity ? "-inf" : meanVolumeDb.toFixed(1)} dB)`);
  return w;
}

function ffmpegStderr(ffmpeg, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args);
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 400_000) err = err.slice(-200_000); });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(err) : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`)); });
  });
}

/**
 * Measure the finished file and build the contact sheet (frames in time
 * order, left to right, top to bottom, 4 per row). Never throws: a QA
 * failure must not fail a good render; it reports what it could do.
 */
export async function inspectRender({ ffmpeg, videoPath, sheetPath, durationSec, hasAudio, dir }) {
  const report = { worker_commit: WORKER_COMMIT, sample_times: [], sheet: false, black: [], mean_volume_db: null, warnings: [], errors: [] };
  try {
    const stderr = await ffmpegStderr(ffmpeg, ["-hide_banner", "-i", videoPath, "-vf", "blackdetect=d=0.5:pix_th=0.08", "-an", "-f", "null", "-"]);
    report.black = parseBlackdetect(stderr);
  } catch (e) { report.errors.push(`blackdetect: ${String(e.message || e).slice(0, 120)}`); }
  if (hasAudio) {
    try {
      const stderr = await ffmpegStderr(ffmpeg, ["-hide_banner", "-i", videoPath, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
      const v = parseMeanVolume(stderr);
      report.mean_volume_db = v === -Infinity ? null : v;
      if (v === -Infinity) report.warnings.push("audio track is silent");
    } catch (e) { report.errors.push(`volumedetect: ${String(e.message || e).slice(0, 120)}`); }
  }
  report.warnings.push(...qaWarnings({ black: report.black, meanVolumeDb: report.mean_volume_db, hasAudio, durationSec }));
  const times = qaSampleTimes(durationSec);
  report.sample_times = times;
  if (sheetPath && times.length) {
    try {
      for (let i = 0; i < times.length; i++) {
        await ffmpegStderr(ffmpeg, ["-y", "-hide_banner", "-ss", String(times[i]), "-i", videoPath, "-frames:v", "1",
          "-vf", "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2:white", `${dir}/qa_${String(i).padStart(2, "0")}.png`], 60_000);
      }
      const rows = Math.ceil(times.length / 4);
      await ffmpegStderr(ffmpeg, ["-y", "-hide_banner", "-framerate", "1", "-i", `${dir}/qa_%02d.png`,
        "-vf", `tile=4x${rows}:padding=8:margin=8:color=0x808080`, "-frames:v", "1", "-q:v", "3", sheetPath], 60_000);
      report.sheet = true;
    } catch (e) { report.errors.push(`contact sheet: ${String(e.message || e).slice(0, 160)}`); }
  }
  return report;
}
