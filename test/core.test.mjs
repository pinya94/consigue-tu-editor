// Pruebas del núcleo: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../core/project.mjs';

function base() {
  let p = P.createProject();
  p.assets['a.mp4'] = { kind: 'video', duration: 10, hasAudio: true };
  p.assets['b.png'] = { kind: 'image', duration: null };
  p = P.addClip(p, { src: 'a.mp4' }).project; // c1: 0-10
  return p;
}
const lane = (p, id = 'v1') => P.findTrack(p, id).clips.map((c) => `${c.id}:${c.start}-${P.clipEnd(c)}@${c.in}`).join(' ');

test('añadir encima de otro clip lo parte (sobrescribe)', () => {
  const p = P.addClip(base(), { src: 'b.png', trackId: 'v1', start: 3, duration: 2 }).project;
  assert.equal(lane(p), 'c1:0-3@0 c2:3-5@0 c3:5-10@5');
  assert.deepEqual(P.validate(p), []);
});

test('cortar crea dos clips continuos', () => {
  const { project: p, newId } = P.splitClip(base(), 'c1', 4);
  assert.equal(newId, 'c2');
  assert.equal(lane(p), 'c1:0-4@0 c2:4-10@4');
});

test('quitar rangos cierra los huecos', () => {
  const p = P.removeRanges(base(), 'c1', [
    { start: 1, end: 2 },
    { start: 5, end: 7 },
  ]);
  assert.equal(lane(p).replace(/c\d+:/g, ''), '0-1@0 1-4@2 4-7@7');
  assert.equal(P.totalDuration(p), 7);
  assert.deepEqual(P.validate(p), []);
});

test('recortar no pasa del final del archivo fuente', () => {
  let p = P.splitClip(base(), 'c1', 4).project;
  p = P.deleteClips(p, ['c2']);
  p = P.trimClip(p, 'c1', { end: 50 });
  assert.equal(lane(p), 'c1:0-10@0');
  p = P.trimClip(p, 'c1', { start: -5 });
  assert.equal(lane(p), 'c1:0-10@0');
});

test('mover sobre otro clip lo sobrescribe sin solapes', () => {
  let p = P.splitClip(base(), 'c1', 4).project; // c1 0-4, c2 4-10
  p = P.moveClip(p, 'c2', 2);
  assert.equal(lane(p), 'c1:0-2@0 c2:2-8@4');
  assert.deepEqual(P.validate(p), []);
});

test('borrar con ripple desplaza lo siguiente', () => {
  let p = P.splitAt(base(), 3);
  p = P.deleteClips(p, ['c1'], { ripple: true });
  assert.equal(lane(p), 'c2:0-7@3');
});

test('no se puede meter vídeo en una pista de audio', () => {
  assert.throws(() => P.addClip(base(), { src: 'a.mp4', trackId: 'a1' }));
});

test('normalize repara ids repetidos y ordena', () => {
  const p = P.normalize({
    tracks: [{ id: 'v1', kind: 'video', clips: [{ id: 'x', src: 'a.mp4', start: 5, duration: 1 }, { id: 'x', src: 'a.mp4', start: 0, duration: 1 }] }],
  });
  const ids = p.tracks[0].clips.map((c) => c.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(p.tracks[0].clips[0].start, 0);
});

test('parseTime acepta segundos y mm:ss', () => {
  assert.equal(P.parseTime('12.5'), 12.5);
  assert.equal(P.parseTime('1:02.5'), 62.5);
  assert.equal(P.parseTime('01:00:00'), 3600);
});
