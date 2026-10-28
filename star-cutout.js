// The star character arrives as a picture on a flat studio background (image
// models can't return transparency). Key out the background colour, sampled
// from the top-left corner, so the character sits cleanly on any scene.
import { spawn } from "node:child_process";

const run = (bin, args) => new Promise((resolve, reject) => {
  const p = spawn(bin, args); const out = []; let err = "";
  p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${bin} ${code}: ${err.slice(-300)}`))));
});

/** Hex colour of the image's corner (its backdrop). */
export async function cornerColor(file, ffmpeg = "ffmpeg") {
  const raw = await run(ffmpeg, ["-v", "error", "-i", file, "-vf", "crop=8:8:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return starKeyHex(raw[0], raw[1], raw[2]);
}

export function starKeyHex(r, g, b) {
  return "0x" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Transparent PNG of the character. */
export async function cutoutStar(src, dest, ffmpeg = "ffmpeg") {
  const key = await cornerColor(src, ffmpeg);
  await run(ffmpeg, ["-y", "-v", "error", "-i", src, "-vf", `colorkey=${key}:0.16:0.08,format=rgba`, "-frames:v", "1", dest]);
  return { key, dest };
}

/** A move clip with its white backdrop keyed to transparency (VP9 + alpha). */
export async function cutoutStarClip(src, dest, ffmpeg = "ffmpeg") {
  const key = await cornerColor(src, ffmpeg);
  await run(ffmpeg, ["-y", "-v", "error", "-i", src, "-an", "-vf", `colorkey=${key}:0.18:0.08,format=yuva420p`,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", "-deadline", "realtime", "-cpu-used", "8", dest]);
  return { key, dest };
}
