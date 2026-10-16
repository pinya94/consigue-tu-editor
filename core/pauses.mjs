// Pausas muertas: tramos sin voz que sobran entre frases. Operaciones puras (sin Node ni DOM).
//
// A diferencia de `silences` (un clip, umbral según el ruido de fondo), esto mira el montaje entero:
//   1. timelineLevels() mide el volumen del timeline en ventanas de 50 ms, con el más alto de los
//      clips con voz que suenan a la vez. Donde no suena ningún clip con voz no se mide (null).
//   2. findPauses() busca los tramos por debajo del umbral (-33 dB): los de 0,6 s o más dentro de un
//      clip y los de 0,4 s o más pegados a un borde (un corte, el principio o el final), incluidos
//      los clips enteros sin voz. De cada pausa deja 0,14 s después de hablar y 0,08 s antes.
// El resultado son rangos del timeline para removeTimeRanges (se quitan en todas las pistas a la vez).
import { clipEnd } from './project.mjs';
import { voiceClips } from './transcript.mjs';

export const PAUSE_DEFAULTS = { window: 0.05, threshold: -33, minInside: 0.6, minEdge: 0.4, keepAfter: 0.14, keepBefore: 0.08 };

// dB (RMS) de `len` muestras de 16 bits a partir de la muestra `from`.
export function windowLevel(samples, from, len) {
  const a = Math.max(0, from);
  const b = Math.min(samples.length, from + len);
  if (b <= a) return -100;
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / (b - a)) / 32768;
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

// audio: { [src]: { samples: Int16Array, rate } } (mono). Devuelve { levels, edges }:
// levels[k] = dB de la ventana k del timeline (o null si ahí no suena ningún clip con voz) y
// edges = segundos del timeline donde empieza o acaba un clip con voz.
export function timelineLevels(p, audio, { window = PAUSE_DEFAULTS.window } = {}) {
  const clips = voiceClips(p).map((x) => x.clip).filter((c) => audio[c.src]);
  const end = clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const n = Math.ceil(end / window - 1e-9);
  const levels = new Array(n).fill(null);
  const edges = new Set();
  for (const c of clips) {
    edges.add(c.start);
    edges.add(clipEnd(c));
    const { samples, rate } = audio[c.src];
    const len = Math.round(window * rate);
    // ventanas cuyo centro cae dentro del clip
    const k0 = Math.max(0, Math.round(c.start / window));
    const k1 = Math.min(n, Math.round(clipEnd(c) / window));
    for (let k = k0; k < k1; k++) {
      const from = Math.round((c.in + k * window - c.start) * rate);
      const v = windowLevel(samples, from, len);
      if (levels[k] === null || v > levels[k]) levels[k] = v;
    }
  }
  return { levels, edges: [...edges].sort((a, b) => a - b) };
}

// levels: dB por ventana (null = sin voz que medir: corta la búsqueda y cuenta como borde).
// Devuelve [{ start, end, length, edge }] en segundos: lo que hay que quitar de cada pausa.
export function findPauses(levels, opts = {}) {
  const o = { ...PAUSE_DEFAULTS, ...opts };
  const edges = opts.edges || [];
  const w = o.window;
  const eps = w / 2;
  const nearEdge = (t) => edges.some((e) => Math.abs(e - t) <= eps);
  const out = [];
  let k = 0;
  while (k < levels.length) {
    if (levels[k] === null || levels[k] >= o.threshold) {
      k++;
      continue;
    }
    let j = k;
    let crosses = false; // la pausa pasa por un corte entre dos clips
    while (j < levels.length && levels[j] !== null && levels[j] < o.threshold) {
      if (j > k && nearEdge(j * w)) crosses = true;
      j++;
    }
    const a = k * w;
    const b = j * w;
    // ¿hay voz justo antes y justo después? (si no, es el principio, el final o un hueco sin voz)
    const voiceBefore = k > 0 && levels[k - 1] !== null;
    const voiceAfter = j < levels.length && levels[j] !== null;
    const edge = crosses || !voiceBefore || !voiceAfter || nearEdge(a) || nearEdge(b);
    if (b - a >= (edge ? o.minEdge : o.minInside) - 1e-9) {
      const start = a + (voiceBefore ? o.keepAfter : 0);
      const end = b - (voiceAfter ? o.keepBefore : 0);
      if (end - start > 1e-9) out.push({ start: r3(start), end: r3(end), length: r3(b - a), edge });
    }
    k = j;
  }
  return out;
}

const r3 = (t) => Math.round(t * 1000) / 1000;
