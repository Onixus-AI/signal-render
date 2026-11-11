function sourceKey(scene) {
  if (!scene?.video_url) return null;
  try { return new URL(scene.video_url).pathname; } catch { return scene.video_url; }
}

// Reusing one short stock clip across several story beats should advance
// through it rather than restart its opening frames at every cut.
export function repeatedSourceOffset(scenes, index, sourceSec, sceneSec) {
  const scene = scenes[index];
  const key = sourceKey(scene);
  if (!key || !(sourceSec > sceneSec) || scenes.filter((s) => sourceKey(s) === key).length < 2) return 0;
  const position = ((Number(scene.start_ms) || 0) / 1000) % sourceSec;
  return Math.min(position, Math.max(0, sourceSec - sceneSec));
}
