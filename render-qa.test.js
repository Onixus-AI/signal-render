import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRender, parseBlackdetect, parseMeanVolume, qaSampleTimes, qaWarnings } from "./render-qa.js";

test("samples spread across the ad and always include the end card", () => {
  const t = qaSampleTimes(30);
  assert.equal(t.length, 12);
  assert.ok(t[0] < 2);
  assert.equal(t.at(-1), 29.6);
  assert.deepEqual([...t].sort((a, b) => a - b), t);
  assert.equal(qaSampleTimes(6).length, 2);
  assert.deepEqual(qaSampleTimes(0), []);
});

test("parses ffmpeg measurements", () => {
  const black = parseBlackdetect("[blackdetect @ 0x1] black_start:4.2 black_end:5.6 black_duration:1.4\n");
  assert.deepEqual(black, [{ start: 4.2, end: 5.6, sec: 1.4 }]);
  assert.equal(parseMeanVolume("[Parsed_volumedetect_0] mean_volume: -21.3 dB"), -21.3);
  assert.equal(parseMeanVolume("mean_volume: -inf dB"), -Infinity);
  assert.equal(parseMeanVolume("nothing"), null);
});

test("warns about mid-ad black screens and near-silent audio, not fades", () => {
  const w = qaWarnings({ durationSec: 30, hasAudio: true, meanVolumeDb: -45,
    black: [{ start: 0, end: 0.6, sec: 0.6 }, { start: 10, end: 11.5, sec: 1.5 }, { start: 29.5, end: 30, sec: 0.5 }] });
  assert.equal(w.length, 2);
  assert.match(w[0], /black screen for 1.5s at 10.0s/);
  assert.match(w[1], /almost silent/);
  assert.deepEqual(qaWarnings({ durationSec: 30, hasAudio: true, meanVolumeDb: -20, black: [] }), []);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("inspects a real file: finds the black stretch and builds the sheet", { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-"));
  const video = join(dir, "v.mp4");
  // 4s purple, 2s black, 4s green, with a tone.
  const r = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x9254FF:s=270x480:d=4", "-f", "lavfi", "-i", "color=c=black:s=270x480:d=2",
    "-f", "lavfi", "-i", "color=c=0x00D67A:s=270x480:d=4", "-f", "lavfi", "-i", "sine=f=440:d=10",
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", video]);
  assert.equal(r.status, 0, String(r.stderr).slice(-300));
  const sheet = join(dir, "sheet.jpg");
  const qa = await inspectRender({ ffmpeg: "ffmpeg", videoPath: video, sheetPath: sheet, durationSec: 10, hasAudio: true, dir });
  assert.deepEqual(qa.errors, []);
  assert.ok(qa.sheet && existsSync(sheet) && statSync(sheet).size > 1000);
  assert.ok(qa.warnings.some((w) => /black screen/.test(w)), JSON.stringify(qa));
  assert.ok(qa.mean_volume_db > -38);
});
