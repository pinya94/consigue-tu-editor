// Pruebas de las pausas muertas (comando pauses): node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPauses, timelineLevels, windowLevel } from '../core/pauses.mjs';
import { createProject, addClip } from '../core/project.mjs';

const W = 0.05;
// niveles por ventana de 50 ms a partir de tramos [segundos, dB]
function levels(...parts) {
  const out = [];
  for (const [secs, db] of parts) for (let i = 0; i < Math.round(secs / W); i++) out.push(db);
  return out;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('una pausa de 0,6 s dentro de un clip se quita dejando 0,14 s después y 0,08 s antes', () => {
  const r = findPauses(levels([1, -20], [0.8, -50], [1, -20]));
  assert.equal(r.length, 1);
  near(r[0].start, 1.14);
  near(r[0].end, 1.72);
  assert.equal(r[0].edge, false);
});

test('las pausas de menos de 0,6 s dentro de un clip se quedan', () => {
  assert.deepEqual(findPauses(levels([1, -20], [0.5, -50], [1, -20])), []);
});

test('el umbral es -33 dB', () => {
  assert.deepEqual(findPauses(levels([1, -20], [1, -32], [1, -20])), []);
  assert.equal(findPauses(levels([1, -20], [1, -34], [1, -20])).length, 1);
});

test('junto a un corte bastan 0,4 s, y del lado del corte no se deja margen', () => {
  // el clip acaba en 1,5 s: la pausa de 0,45 s llega hasta el corte y el siguiente clip empieza hablando
  const lv = levels([1.05, -20], [0.45, -50], [1, -20]);
  const r = findPauses(lv, { edges: [1.5] });
  assert.equal(r.length, 1);
  assert.equal(r[0].edge, true);
  near(r[0].start, 1.19);
  near(r[0].end, 1.42);
  // al principio del vídeo no hay voz antes: se quita desde el primer instante
  const s = findPauses(levels([0.5, -50], [1, -20]));
  near(s[0].start, 0);
  near(s[0].end, 0.42);
  // al final, igual
  const e = findPauses(levels([1, -20], [0.5, -50]));
  near(e[0].start, 1.14);
  near(e[0].end, 1.5);
});

test('una pausa que cruza un corte cuenta como pegada al borde', () => {
  // 0,25 s de silencio al final de un clip + 0,25 s al principio del siguiente
  const r = findPauses(levels([1, -20], [0.5, -50], [1, -20]), { edges: [1.25] });
  assert.equal(r.length, 1);
  near(r[0].start, 1.14);
  near(r[0].end, 1.42);
});

test('un clip entero sin voz se quita, dejando solo los márgenes de la voz de alrededor', () => {
  const r = findPauses(levels([1, -20], [2, -60], [1, -20]), { edges: [1, 3] });
  assert.equal(r.length, 1);
  near(r[0].start, 1.14);
  near(r[0].end, 2.92);
});

test('donde no suena ningún clip con voz no se mide (y corta la pausa)', () => {
  const lv = [...levels([1, -20], [0.3, -50]), ...new Array(20).fill(null), ...levels([0.3, -50], [1, -20])];
  // cada trozo de silencio (0,3 s) es corto incluso para un borde
  assert.deepEqual(findPauses(lv), []);
  assert.deepEqual(findPauses(new Array(40).fill(null)), []);
});

test('timelineLevels mide el timeline con el clip que suena y marca los cortes', () => {
  const rate = 1000;
  const loud = new Int16Array(rate * 4).fill(8000); // ≈ -12 dB
  loud.fill(0, 1000, 2000); // silencio entre el segundo 1 y el 2 del archivo
  let p = createProject({ fps: 30 });
  p.assets['a.wav'] = { kind: 'audio', duration: 4, hasAudio: true };
  p = addClip(p, { src: 'a.wav', start: 0, in: 0, duration: 1.5 }).project; // 0 → 1,5 (acaba en silencio)
  p = addClip(p, { src: 'a.wav', start: 1.5, in: 3, duration: 1 }).project; // 1,5 → 2,5 (habla)
  const { levels: lv, edges } = timelineLevels(p, { 'a.wav': { samples: loud, rate } });
  assert.equal(lv.length, 50);
  assert.ok(lv[5] > -15);
  assert.equal(lv[25], -100);
  assert.ok(lv[35] > -15);
  assert.deepEqual(edges, [0, 1.5, 2.5]);
  const r = findPauses(lv, { edges });
  assert.equal(r.length, 1);
  near(r[0].start, 1.14);
  near(r[0].end, 1.42);
});

test('windowLevel da -100 dB al silencio digital', () => {
  assert.equal(windowLevel(new Int16Array(100), 0, 50), -100);
  near(Math.round(windowLevel(new Int16Array(100).fill(32767), 0, 50)), 0);
});
