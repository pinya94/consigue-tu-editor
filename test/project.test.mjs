// Pruebas de los cortes: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../core/project.mjs';

test('al cortar no quedan restos de menos de medio fotograma', () => {
  let p = P.createProject({ fps: 30 });
  const added = P.addClip(p, { trackId: 'v1', src: 'a.mp4', start: 0, in: 0, duration: 10 });
  p = added.project;
  const id = added.clipId;
  p = P.removeRanges(p, id, [{ start: 2, end: 9.999 }]);
  const clips = p.tracks[0].clips;
  assert.ok(clips.every((c) => c.duration >= 0.5 / 30), clips.map((c) => c.duration).join(','));
});
