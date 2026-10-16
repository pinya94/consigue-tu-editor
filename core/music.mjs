// Música de fondo original, compuesta a la medida del vídeo (sin derechos de terceros).
// Operaciones puras (sin Node ni DOM): devuelve las muestras y el WAV en memoria.
//
// Lo-fi ambiental suave a 84 BPM: colchón de acordes cálido (Am9 · Fmaj7 · Cmaj7 · G6), piano
// eléctrico arpegiado y bajo redondo desde el compás 5, y percusión mínima desde el 9. Cada 16
// compases quita la percusión 4 compases para respirar. Empieza y acaba con un fundido.

export const LOFI = { bpm: 84, sampleRate: 44100 };

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// (en midi)
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 67, 71] },
  { root: 41, notes: [53, 57, 60, 64, 69] },
  { root: 48, notes: [55, 60, 64, 67, 71] },
  { root: 43, notes: [55, 59, 62, 64, 67] },
];
const PATTERN = [0, 2, 1, 3, 2, 4, 3, 1];

// Devuelve { left, right, sampleRate, bars } (Float32Array normalizados a -1 dB de pico).
// `seed` cambia los huecos y la intensidad del piano y el charles, no la armonía.
export function composeLofi(duration, { sampleRate = LOFI.sampleRate, bpm = LOFI.bpm, seed = 7 } = {}) {
  if (!(duration > 0)) throw new Error('La duración de la música tiene que ser mayor que 0');
  const SR = sampleRate;
  const BEAT = 60 / bpm;
  const BAR = BEAT * 4;
  const N = Math.ceil(duration * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let s0 = Math.max(1, Math.floor(seed)) % 2147483647;
  const rnd = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
  const add = (i, l, r) => {
    L[i] += l;
    R[i] += r;
  };
  const span = (t0, len) => [Math.max(0, Math.floor(t0 * SR)), Math.min(N, Math.floor((t0 + len) * SR))];
  const bars = Math.ceil(duration / BAR);

  // colchón (pad): senos desafinados con ataque y caída lentos
  for (let b = 0; b < bars; b++) {
    const ch = CHORDS[b % 4];
    const t0 = b * BAR;
    const len = BAR * 1.15; // se solapa un poco con el siguiente
    ch.notes.forEach((m, k) => {
      const f = hz(m);
      const pan = (k / (ch.notes.length - 1)) * 0.8 - 0.4;
      const [a, e] = span(t0, len);
      for (let s = a; s < e; s++) {
        const ts = s / SR;
        const t = ts - t0;
        const env = Math.min(1, t / 0.9) * Math.min(1, (len - t) / 0.6);
        const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.18 * ts + k);
        const v = (Math.sin(2 * Math.PI * f * ts) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * ts + 1) + 0.12 * Math.sin(2 * Math.PI * f * 2 * ts)) * env * trem * 0.028;
        add(s, v * (1 - pan), v * (1 + pan));
      }
    });
  }

  // piano eléctrico: arpegio en corcheas, desde el compás 5
  for (let b = 4; b < bars; b++) {
    const ch = CHORDS[b % 4];
    for (let q = 0; q < 8; q++) {
      if (rnd() < 0.18) continue; // algunos huecos: menos mecánico
      const f = hz(ch.notes[PATTERN[q]] + 12);
      const t0 = b * BAR + q * (BEAT / 2) + (q % 2 ? 0.02 : 0); // un pelo de swing
      const vel = 0.6 + 0.4 * rnd();
      const pan = Math.sin(q) * 0.5;
      const [a, e] = span(t0, 1.6);
      for (let s = a; s < e; s++) {
        const t = s / SR - t0;
        const env = Math.exp(-t * 3.2) * Math.min(1, t / 0.004);
        const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 6)) * env * vel * 0.03;
        add(s, v * (1 - pan), v * (1 + pan));
      }
    }
  }

  // bajo: raíz en blancas, desde el compás 5
  for (let b = 4; b < bars; b++) {
    const f = hz(CHORDS[b % 4].root);
    for (const off of [0, BAR / 2]) {
      const t0 = b * BAR + off;
      const [a, e] = span(t0, BAR / 2);
      for (let s = a; s < e; s++) {
        const t = s / SR - t0;
        const env = Math.min(1, t / 0.02) * Math.exp(-t * 1.2);
        const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * env * 0.09;
        add(s, v, v);
      }
    }
  }

  // percusión mínima: bombo suave en 1 y 3, charles en contratiempo
  for (let b = 8; b < bars; b++) {
    if (b % 16 >= 12) continue; // descanso de 4 compases cada 16
    for (let beat = 0; beat < 4; beat++) {
      const t0 = b * BAR + beat * BEAT;
      if (beat === 0 || beat === 2) {
        const [a, e] = span(t0, 0.35);
        for (let s = a; s < e; s++) {
          const t = s / SR - t0;
          const f = 50 + 70 * Math.exp(-t * 30);
          const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.16;
          add(s, v, v);
        }
      }
      // charles: ruido filtrado muy corto en la corchea de contratiempo
      const th = t0 + BEAT / 2 + 0.015;
      let prev = 0;
      const [a, e] = span(th, 0.06);
      for (let s = a; s < e; s++) {
        const t = s / SR - th;
        const n = rnd() * 2 - 1;
        const hp = n - prev;
        prev = n;
        const v = hp * Math.exp(-t * 60) * 0.022;
        add(s, v * 0.8, v * 1.2);
      }
    }
  }

  // eco suave (reverberación barata), fundidos y normalización
  const D1 = Math.floor(0.137 * SR);
  const D2 = Math.floor(0.211 * SR);
  for (let i = D2; i < N; i++) {
    L[i] += 0.28 * L[i - D1] + 0.18 * R[i - D2];
    R[i] += 0.28 * R[i - D1] + 0.18 * L[i - D2];
  }
  const fadeIn = Math.min(3, duration / 4) * SR;
  const fadeOut = Math.min(6, duration / 3) * SR;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const g = Math.min(1, i / fadeIn) * Math.min(1, (N - i) / fadeOut);
    L[i] *= g;
    R[i] *= g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < N; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  return { left: L, right: R, sampleRate: SR, bars };
}

// WAV estéreo de 16 bits en memoria.
export function stereoWav(left, right, sampleRate) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  const q = (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, q(left[i]), true);
    v.setInt16(46 + i * 4, q(right[i]), true);
  }
  return new Uint8Array(buf);
}
