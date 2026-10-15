// Pruebas del ducking (la música baja cuando se habla): node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addClip, addTrack, updateTrack } from '../core/project.mjs';
import { duckEnvelope, voiceActivity, hasDucking, duckLevel, PEAKS_RATE } from '../core/duck.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('la música baja mientras se habla y vuelve a subir despacio', () => {
  const act = new Uint8Array(600);
  act.fill(1, 200, 300); // voz de 2 a 3 s
  const env = duckEnvelope(act, { level: 0.2, attack: 0.1, release: 0.5, hold: 0.3 });
  assert.equal(env[50], 1);
  near(env[200], 0.2); // ya está abajo cuando empieza la voz (baja antes)
  near(env[250], 0.2);
  assert.ok(env[320] > 0.2 && env[320] < 1); // subiendo
  assert.equal(env[400], 1);
});

test('las pausas cortas entre palabras no hacen subir la música', () => {
  const act = new Uint8Array(500);
  act.fill(1, 100, 200);
  act.fill(1, 220, 300); // pausa de 0,2 s
  const env = duckEnvelope(act, { level: 0.25, hold: 0.3 });
  near(env[210], 0.25);
});

test('actividad de voz en el timeline, sin contar la música', () => {
  let p = createProject();
  p.assets['v.mp4'] = { kind: 'video', duration: 10, hasAudio: true };
  p.assets['m.mp3'] = { kind: 'audio', duration: 10 };
  p = addClip(p, { src: 'v.mp4', start: 0, in: 2, duration: 3 }).project;
  const t = addTrack(p, 'audio', 'Música');
  p = updateTrack(t.project, t.trackId, { duck: 0.3 });
  p = addClip(p, { src: 'm.mp3', trackId: t.trackId, start: 0, duration: 3 }).project;
  assert.equal(hasDucking(p), true);
  assert.equal(duckLevel(p.tracks.find((x) => x.id === t.trackId)), 0.3);
  const voz = new Uint8Array(10 * PEAKS_RATE).fill(5);
  voz.fill(200, 250, 300); // se habla de 2,5 a 3 s del archivo → 0,5 a 1 s del timeline
  for (let i = 0; i < voz.length; i += 7) voz[i] = 10; // algo de ruido
  const act = voiceActivity(p, { 'v.mp4': voz, 'm.mp3': new Uint8Array(1000).fill(255) });
  assert.equal(act[60], 1);
  assert.equal(act[20], 0); // la música no cuenta como voz
  assert.equal(act[200], 0);
});
