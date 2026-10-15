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

test('borrar un trozo de la pista principal adelanta también las animaciones', () => {
  let p = P.createProject({ fps: 30 });
  let r = P.addClip(p, { trackId: 'v1', src: 'a.mp4', start: 0, in: 0, duration: 10 });
  p = r.project;
  p = P.splitClip(p, r.clipId, 4).project;
  p = P.splitClip(p, p.tracks[0].clips.find((c) => c.start === 4).id, 6).project;
  const mid = p.tracks[0].clips.find((c) => c.start === 4).id;
  r = P.addClip(p, { trackId: 'v2', src: 'titulo.html', start: 7, duration: 2 });
  p = P.rippleDeleteClips(r.project, [mid]);
  assert.equal(P.totalDuration(p), 8);
  assert.equal(p.tracks.find((t) => t.id === 'v2').clips[0].start, 5);
  // borrar una animación no mueve el vídeo
  p = P.rippleDeleteClips(p, [p.tracks.find((t) => t.id === 'v2').clips[0].id]);
  assert.equal(P.totalDuration(p), 8);
});
