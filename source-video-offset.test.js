import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatedSourceOffset } from './source-video-offset.js';

test('reused stock footage advances across story cuts without running past source', () => {
  const scenes = [0, 4000, 7000, 10000].map((start_ms) => ({
    start_ms,
    video_url: 'https://media.example/stock/6789593.mp4?token=' + start_ms,
  }));
  assert.equal(repeatedSourceOffset(scenes, 0, 7, 4), 0);
  assert.equal(repeatedSourceOffset(scenes, 1, 7, 3), 4);
  assert.equal(repeatedSourceOffset(scenes, 2, 7, 3), 0);
  assert.equal(repeatedSourceOffset(scenes, 3, 7, 4), 3);
});

test('independent or short clips retain their original start', () => {
  const scenes = [
    { start_ms: 4000, video_url: 'https://media.example/a.mp4' },
    { start_ms: 8000, video_url: 'https://media.example/b.mp4' },
  ];
  assert.equal(repeatedSourceOffset(scenes, 1, 7, 3), 0);
  assert.equal(repeatedSourceOffset([scenes[0], scenes[0]], 1, 2, 3), 0);
});
