// CI smoke test: render one Command beat with the installed EffectCraft CLI,
// then pull stills at key moments so a person can grade the motion.
// Usage: EFFECTCRAFT_CLI=/path/effectcraft-cli node scripts/effectcraft-smoke.mjs OUT_DIR
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { effectcraftCli, renderCommandBeat } from "../effectcraft.js";

const out = resolve(process.argv[2] || "effectcraft-smoke");
await mkdir(out, { recursive: true });
const graphic = { headline: "Your follow-ups run themselves now", points: ["Leads answered in minutes", "Invoices chased automatically", "Every job logged"] };
let failed = false;
for (const [w, h, d] of [[1080, 1920, 3.6], [1920, 1080, 3.6]]) {
  const mp4 = join(out, `beat-${w}x${h}.mp4`);
  const r = await renderCommandBeat(graphic, mp4, { w, h, durSec: d, dir: out, idx: `${w}x${h}`, bin: effectcraftCli() });
  console.log(`${w}x${h}`, JSON.stringify(r));
  if (!r.ok) { failed = true; continue; }
  for (const t of [0.15, 0.45, 0.9, 1.3, 2.2, 3.4]) {
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", join(out, `frame-${w}x${h}-${t}.png`)], { stdio: "inherit" });
  }
  // One contact sheet per canvas: the six stills side by side, small enough to review quickly.
  const shots = [0.15, 0.45, 0.9, 1.3, 2.2, 3.4].map((t) => ["-i", join(out, `frame-${w}x${h}-${t}.png`)]).flat();
  const cw = w > h ? 640 : 360;
  spawnSync("ffmpeg", ["-v", "error", "-y", ...shots, "-filter_complex",
    `${[0, 1, 2, 3, 4, 5].map((i) => `[${i}:v]scale=${cw}:-2[s${i}]`).join(";")};${[0, 1, 2, 3, 4, 5].map((i) => `[s${i}]`).join("")}xstack=inputs=6:layout=${w > h ? "0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0" : "0_0|w0_0|w0+w1_0|w0+w1+w2_0|w0+w1+w2+w3_0|w0+w1+w2+w3+w4_0"}`,
    "-q:v", "3", join(out, `sheet-${w}x${h}.jpg`)], { stdio: "inherit" });
  spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration", "-of", "compact", mp4], { stdio: "inherit" });
}
process.exit(failed ? 1 : 0);
