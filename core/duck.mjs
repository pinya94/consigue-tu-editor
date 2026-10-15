// Ducking: la música baja sola cuando se habla. Operaciones puras (sin Node ni DOM).
//
// Las pistas de audio con `duck` (true o el volumen al que bajan, p. ej. 0.25) son "música". El resto
// del audio es "voz". Con los picos de la voz (core/waveform.mjs) se calcula, cada 10 ms, si alguien
// habla, y de ahí una curva de volumen suave para la música: baja un poco antes de que empiece la voz
// y vuelve a subir despacio cuando acaba. La misma curva la usan la exportación y la preview.
import { kindOf, totalDuration } from './project.mjs';

export const PEAKS_RATE = 100; // picos por segundo
export const DUCK_DEFAULTS = { level: 0.25, attack: 0.15, release: 0.6, hold: 0.3 };

export function duckLevel(track) {
  if (!track?.duck) return null;
  return typeof track.duck === 'number' ? Math.max(0, Math.min(1, track.duck)) : DUCK_DEFAULTS.level;
}

export function hasDucking(p) {
  return p.tracks.some((t) => t.kind === 'audio' && duckLevel(t) != null && !t.muted && t.clips.length);
}

// Umbral de voz para unos picos (0-255): un tercio del camino entre el ruido de fondo y la voz.
export function peakThreshold(peaks) {
  const s = Array.from(peaks).sort((a, b) => a - b);
  if (s.length < 20) return 40;
  const floor = s[Math.floor(s.length * 0.1)];
  const speech = s[Math.floor(s.length * 0.9)];
  return floor + Math.max(8, (speech - floor) / 3);
}

// Actividad de voz en el timeline (1 = se habla) a PEAKS_RATE.
// peaksBySrc: { src: Uint8Array } de los archivos de voz.
export function voiceActivity(p, peaksBySrc) {
  const n = Math.ceil(totalDuration(p) * PEAKS_RATE) + 1;
  const act = new Uint8Array(n);
  const thresholds = new Map();
  for (const t of p.tracks) {
    if (t.muted || duckLevel(t) != null || (t.kind === 'video' && t.hidden)) continue;
    for (const c of t.clips) {
      const k = kindOf(c.src);
      if (k !== 'video' && k !== 'audio') continue;
      if ((c.volume ?? 1) <= 0) continue;
      const peaks = peaksBySrc[c.src];
      if (!peaks) continue;
      if (!thresholds.has(c.src)) thresholds.set(c.src, peakThreshold(peaks));
      const thr = thresholds.get(c.src);
      const a = Math.round(c.start * PEAKS_RATE);
      const from = Math.round(c.in * PEAKS_RATE);
      const len = Math.round(c.duration * PEAKS_RATE);
      for (let i = 0; i < len && a + i < n; i++) if (peaks[from + i] > thr) act[a + i] = 1;
    }
  }
  return act;
}

// Curva de volumen (0-1) para la música a PEAKS_RATE.
// - hold: los huecos de voz más cortos que esto no hacen subir la música (pausas entre palabras).
// - attack: cuánto tarda en bajar; empieza a bajar `attack` antes de la voz, así la primera sílaba ya se oye clara.
// - release: cuánto tarda en volver a subir.
export function duckEnvelope(activity, opts = {}) {
  const { level, attack, release, hold } = { ...DUCK_DEFAULTS, ...opts };
  const n = activity.length;
  const r = PEAKS_RATE;
  // 1. objetivo: abajo mientras se habla, con las pausas cortas rellenas
  const target = new Uint8Array(n);
  let lastOn = -Infinity;
  for (let i = 0; i < n; i++) {
    if (activity[i]) {
      if (i - lastOn <= hold * r) target.fill(1, Math.max(0, lastOn), i);
      target[i] = 1;
      lastOn = i;
    }
  }
  // 2. adelantar las bajadas `attack` segundos
  const pre = Math.round(attack * r);
  for (let i = 0; i < n; i++) if (target[i] && (i === 0 || !target[i - 1])) target.fill(1, Math.max(0, i - pre), i);
  // 3. rampas lineales
  const down = (1 - level) / Math.max(1, attack * r);
  const up = (1 - level) / Math.max(1, release * r);
  const out = new Float32Array(n);
  let g = target[0] ? level : 1;
  for (let i = 0; i < n; i++) {
    const want = target[i] ? level : 1;
    if (g > want) g = Math.max(want, g - down);
    else if (g < want) g = Math.min(want, g + up);
    out[i] = g;
  }
  return out;
}

// Valor de la curva en el instante t (para la preview).
export function envelopeAt(env, t) {
  if (!env || !env.length) return 1;
  const i = Math.max(0, Math.min(env.length - 1, Math.round(t * PEAKS_RATE)));
  return env[i];
}
