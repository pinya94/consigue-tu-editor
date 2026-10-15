// Pruebas de la transcripción, las tomas repetidas y los cortes por texto: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addClip, removeTimeRanges, zoomAt, findClip, splitClip } from '../core/project.mjs';
import {
  wordsFromWhisper, speechMask, dropHallucinations, refineWords, mapToTimeline, buildPhrases, findRetakes, cutRangeForWords,
  findText, findSpan, diffWords, cutProblems, normalizeWord, mergeRanges,
} from '../core/transcript.mjs';

// palabras de prueba: "texto" con un inicio cada `step` segundos (o tiempos dados)
function words(text, { start = 0, step = 0.4, len = 0.3 } = {}) {
  return text.split(' ').map((w, i) => ({ w, start: +(start + i * step).toFixed(3), end: +(start + i * step + len).toFixed(3), i }));
}
function concat(...lists) {
  const out = lists.flat().sort((a, b) => a.start - b.start);
  out.forEach((w, i) => (w.i = i));
  return out;
}

test('normaliza palabras: sin mayúsculas, tildes ni signos', () => {
  assert.equal(normalizeWord('¿Vídeo,'), 'video');
  assert.equal(normalizeWord('Año.'), 'ano'); // la ñ también pierde la tilde: "año" y "ano" se confunden, pero whisper ya acierta la ñ casi siempre
});

test('junta los tokens de whisper en palabras con el tiempo del DTW', () => {
  const json = {
    transcription: [
      {
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 }, t_dtw: -1, p: 0.5 },
          { text: ' Pi', offsets: { from: 0, to: 200 }, t_dtw: 30, p: 0.9 },
          { text: 'ensas', offsets: { from: 200, to: 500 }, t_dtw: 40, p: 0.8 },
          { text: ' que', offsets: { from: 500, to: 700 }, t_dtw: 60, p: 0.99 },
          { text: ',', offsets: { from: 700, to: 800 }, t_dtw: 70, p: 0.5 },
          { text: ' sí', offsets: { from: 800, to: 1000 }, t_dtw: 85, p: 0.9 },
        ],
      },
    ],
  };
  const w = wordsFromWhisper(json);
  assert.deepEqual(w.map((x) => x.w), ['Piensas', 'que,', 'sí']);
  assert.equal(w[0].start, 0.3);
  assert.equal(w[1].start, 0.6);
  assert.equal(w[0].p, 0.8);
  assert.ok(w[0].end <= w[1].start);
});

test('la máscara de voz rellena huecos cortos y quita picos sueltos', () => {
  const lv = new Float32Array(100).fill(-60);
  for (let i = 10; i < 30; i++) lv[i] = -20;
  lv[18] = lv[19] = -60; // oclusiva dentro de la palabra
  lv[60] = -20; // pico suelto
  const m = speechMask(lv, -40);
  assert.equal(m[18], 1);
  assert.equal(m[60], 0);
  assert.equal(m[40], 0);
});

test('ajusta las palabras a la voz: las pausas no quedan dentro de una palabra', () => {
  // voz de 1,0 a 1,6 s y de 4,0 a 4,5 s
  const mask = new Uint8Array(600);
  mask.fill(1, 100, 160);
  mask.fill(1, 400, 450);
  // whisper dice que la primera palabra dura hasta que empieza la segunda (estirada sobre la pausa)
  const raw = [
    { w: 'hola', start: 1.05, end: 4.0, raw: 1.0 },
    { w: 'adiós', start: 3.9, end: 4.6, raw: 3.9 },
  ];
  const r = refineWords(raw, mask);
  assert.ok(Math.abs(r[0].start - 1.0) < 0.06, `inicio ${r[0].start}`);
  assert.ok(Math.abs(r[0].end - 1.6) < 0.02, `fin ${r[0].end}`);
  assert.ok(Math.abs(r[1].start - 4.0) < 0.02, `inicio ${r[1].start}`);
  assert.ok(Math.abs(r[1].end - 4.5) < 0.02, `fin ${r[1].end}`);
});

test('una respiración después de la pausa no alarga la palabra', () => {
  const mask = new Uint8Array(600);
  mask.fill(1, 100, 150); // palabra
  mask.fill(1, 300, 306); // respiración
  mask.fill(1, 400, 450); // siguiente palabra
  const r = refineWords([{ w: 'uno', start: 1.0, end: 4.0 }, { w: 'dos', start: 4.0, end: 4.5 }], mask);
  assert.equal(r[0].end, 1.5);
});

test('si el DTW llega tarde y cae en silencio, la palabra se pega a la voz de antes', () => {
  const mask = new Uint8Array(1000);
  mask.fill(1, 400, 510); // "en comentarios" de 4,0 a 5,1
  mask.fill(1, 870, 950);
  const raw = [
    { w: 'en', start: 4.05, end: 4.4, raw: 4.0 },
    { w: 'comentarios,', start: 5.36, end: 8.7, raw: 4.45 },
    { w: 'pero', start: 8.79, end: 9.5, raw: 6.3 },
  ];
  const r = refineWords(raw, mask);
  assert.ok(r[1].start < 5.1 && r[1].start > 4.05, `inicio ${r[1].start}`);
  assert.equal(r[1].end, 5.1);
});

test('quita lo que whisper se inventa en los silencios', () => {
  const w = [
    { w: 'hola', start: 0, end: 0.3 },
    { w: 'bajito', start: 0.5, end: 0.8, doubt: true },
    { w: 'adiós.', start: 1, end: 1.3 },
    { w: '(Silencio)', start: 5, end: 9 },
    { w: '¡Gracias', start: 20, end: 20.3, doubt: true },
    { w: 'por', start: 20.3, end: 20.5, doubt: true },
    { w: 'ver!', start: 20.5, end: 20.8, doubt: true },
  ];
  assert.deepEqual(dropHallucinations(w).map((x) => x.w), ['hola', 'bajito', 'adiós.']);
});

test('pasa las palabras al timeline y marca las que parte un corte', () => {
  let p = createProject();
  p.assets['a.mp4'] = { kind: 'video', duration: 20, hasAudio: true };
  p = addClip(p, { src: 'a.mp4', start: 0, in: 0, duration: 2 }).project; // 0-2 del archivo
  p = addClip(p, { src: 'a.mp4', start: 2, in: 5, duration: 3 }).project; // 5-8 del archivo, en 2-5
  const src = [
    { w: 'uno', start: 0.2, end: 0.6 },
    { w: 'dos', start: 1.7, end: 2.2 }, // la corta el final del primer clip
    { w: 'tres', start: 3, end: 3.5 }, // quitada
    { w: 'cuatro', start: 5.5, end: 6 },
  ];
  const tw = mapToTimeline(p, { 'a.mp4': src });
  assert.deepEqual(tw.map((w) => w.w), ['uno', 'dos', 'cuatro']);
  assert.equal(tw[1].cut, 'end');
  assert.equal(tw[2].start, 2.5);
  assert.equal(tw[2].clip, 'c2');
  // una pista con ducking (música) no se transcribe
  p.tracks.push({ id: 'a2', kind: 'audio', name: 'Música', duck: true, clips: [{ id: 'm1', src: 'a.mp4', start: 0, in: 0, duration: 5 }] });
  assert.equal(mapToTimeline(p, { 'a.mp4': src }).length, 3);
  assert.equal(cutProblems(p, tw).filter((x) => x.type === 'palabra-cortada').length, 1);
});

test('frases: se parten en puntos y pausas largas', () => {
  const w = concat(words('hola a todos.', { start: 0 }), words('hoy vamos a ver', { start: 1.2 }), words('algo nuevo', { start: 4 }));
  const ph = buildPhrases(w);
  assert.deepEqual(ph.map((x) => x.text), ['hola a todos.', 'hoy vamos a ver', 'algo nuevo']);
});

test('detecta una toma repetida y propone quitar la primera', () => {
  const w = concat(
    words('en mi último vídeo enseñé', { start: 0 }),
    words('en mi último vídeo enseñé cómo editaba con Claude', { start: 3 }),
    words('y funcionó', { start: 7 }),
  );
  const r = findRetakes(w).filter((x) => x.type === 'retake');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].words, [0, 4]);
  assert.match(r[0].keep.text, /cómo editaba/);
  // el corte va de poco después de la toma mala a poco antes de la buena
  assert.ok(r[0].start <= 0 && r[0].end > 1.9 && r[0].end < 3, `${r[0].start}-${r[0].end}`);
});

test('tres intentos: se quitan los dos primeros y se queda el último', () => {
  const w = concat(words('esto es lo que', { start: 0 }), words('esto es lo que quería', { start: 3 }), words('esto es lo que quería contaros hoy', { start: 6 }));
  const r = findRetakes(w).filter((x) => x.type === 'retake');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].words, [0, 8]);
});

test('frases distintas no son tomas repetidas', () => {
  const w = concat(words('hoy vamos a instalar el editor', { start: 0 }), words('después abrimos un proyecto nuevo', { start: 4 }));
  assert.equal(findRetakes(w).filter((x) => x.type === 'retake').length, 0);
});

test('palabras repetidas seguidas, muletillas y frases a medias', () => {
  const w = concat(words('y bueno, y bueno vamos allá eh con esto', { start: 0 }), words('porque la', { start: 5 }), words('otra cosa distinta.', { start: 8 }));
  const r = findRetakes(w);
  const rep = r.find((x) => x.type === 'repeticion');
  assert.ok(rep);
  assert.deepEqual(rep.words, [0, 1]);
  assert.ok(r.find((x) => x.type === 'muletilla' && x.text === 'eh'));
  assert.ok(r.find((x) => x.type === 'cortada' && /porque la/.test(x.text)));
});

test('rango de corte por palabras: deja una pausa natural a cada lado', () => {
  const w = [
    { w: 'a', start: 0, end: 0.5 },
    { w: 'b', start: 1.5, end: 2.0 },
    { w: 'c', start: 3.0, end: 3.5 },
  ];
  const r = cutRangeForWords(w, 1, 1);
  assert.equal(r.start, 0.72); // 0,22 s de cola tras "a"
  assert.equal(r.end, 2.9); // 0,1 s antes de "c"
  assert.equal(r.tight.length, 0);
  // sin silencio entre palabras: corta en medio y avisa
  const pegadas = [{ w: 'a', start: 0, end: 0.5 }, { w: 'b', start: 0.51, end: 1 }, { w: 'c', start: 1.01, end: 1.5 }];
  assert.equal(cutRangeForWords(pegadas, 1, 1).tight.length, 2);
});

test('busca texto aunque whisper falle alguna palabra', () => {
  const w = words('si al acabar este vídeo piensas que es clickbait déjalo en comentarios');
  assert.deepEqual(findText(w, 'piensas que es').map((m) => [m.i, m.j]), [[5, 7]]);
  assert.deepEqual(findText(w, '¿Piensas que es click bait?…').length, 1);
  const span = findSpan(w, 'este vídeo…', '…en comentarios');
  assert.deepEqual([span.i, span.j], [3, 11]);
  assert.equal(findSpan(w, 'no aparece nunca jamás'), null);
});

test('diferencias entre lo esperado y lo que se oye', () => {
  const exp = words('hoy vamos a ver cómo se edita un vídeo');
  const heard = words('hoy vamos a ver se edita un vídeo');
  const d = diffWords(exp, heard);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].expected, ['cómo']);
  assert.equal(d[0].minor, true);
});

test('une rangos que se solapan', () => {
  assert.deepEqual(mergeRanges([{ start: 3, end: 4 }, { start: 1, end: 2 }, { start: 1.5, end: 3 }]), [{ start: 1, end: 4 }]);
});

test('quitar rangos del timeline mueve todas las pistas y no parte las animaciones', () => {
  let p = createProject();
  p.assets['v.mp4'] = { kind: 'video', duration: 60, hasAudio: true };
  p.assets['t.html'] = { kind: 'html', duration: 4 };
  p = addClip(p, { src: 'v.mp4', start: 0, duration: 20 }).project; // c1 en v1
  p = addClip(p, { src: 't.html', trackId: 'v2', start: 9, duration: 4 }).project; // c2: 9-13
  p = addClip(p, { src: 't.html', trackId: 'v2', start: 15, duration: 2 }).project; // c3: 15-17
  const r = removeTimeRanges(p, [{ start: 10, end: 12 }]);
  const v1 = r.tracks.find((t) => t.id === 'v1').clips;
  assert.deepEqual(v1.map((c) => [c.start, c.in, c.duration]), [[0, 0, 10], [10, 12, 8]]);
  const c2 = findClip(r, 'c2').clip;
  assert.deepEqual([c2.start, c2.duration], [9, 2]); // se acorta, no se parte
  assert.equal(findClip(r, 'c3').clip.start, 13); // lo de detrás se adelanta igual que el vídeo
});

test('zoom animado con curva suave', () => {
  const c = { id: 'c', src: 'v.mp4', start: 0, in: 0, duration: 10, zoom: 1, zoomTo: 1.4, zoomTime: 2 };
  assert.equal(zoomAt(c, 0), 1);
  assert.ok(Math.abs(zoomAt(c, 1) - 1.2) < 1e-9);
  assert.equal(zoomAt(c, 2), 1.4);
  assert.equal(zoomAt(c, 8), 1.4);
  assert.ok(zoomAt(c, 0.2) - 1 < 0.4 * 0.2 / 2); // empieza despacio
  assert.equal(zoomAt({ ...c, zoomTo: undefined, zoom: 1.2 }, 5), 1.2);
  assert.ok(Math.abs(zoomAt({ ...c, zoomTime: undefined }, 5) - 1.2) < 1e-9); // sin zoomTime: todo el clip
});

test('al partir un clip con zoom animado, el segundo trozo continúa la animación', () => {
  let p = createProject();
  p.assets['v.mp4'] = { kind: 'video', duration: 60, hasAudio: true };
  p = addClip(p, { src: 'v.mp4', start: 0, duration: 10 }).project;
  p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, zoom: 1, zoomTo: 1.4 })) })) };
  const { project: q, newId } = splitClip(p, 'c1', 5);
  const a = findClip(q, 'c1').clip;
  const b = findClip(q, newId).clip;
  assert.equal(a.zoomTime, 10); // la mitad izquierda no acelera la animación
  assert.equal(zoomAt(a, 5), 1.2);
  assert.equal(b.zoom, 1.2); // la derecha empieza donde iba
  assert.equal(b.zoomTime, 5);
  assert.equal(zoomAt(b, 5), 1.4);
});
