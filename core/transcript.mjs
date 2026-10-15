// Transcripción: operaciones puras sobre palabras con tiempo (sin Node ni DOM).
//
// Flujo:
//   1. whisper.cpp transcribe cada archivo fuente y da el tiempo de cada token (alineación DTW).
//   2. wordsFromWhisper() junta los tokens en palabras.
//   3. refineWords() ajusta el inicio y el final de cada palabra a la voz real, con la energía del audio:
//      así los finales no se "estiran" sobre los silencios y los cortes caen en silencios de verdad.
//   4. mapToTimeline() pasa las palabras del archivo fuente al timeline según los clips del proyecto.
//      Se recalcula en cada cambio, así que la transcripción sigue al montaje sin volver a transcribir.
// Con las palabras del timeline: frases, tomas repetidas (findRetakes), buscar texto (findText) y
// el rango que hay que quitar para borrar unas palabras sin cortar ninguna (cutRangeForWords).
import { clipEnd, kindOf, round } from './project.mjs';

export const FRAME_RATE = 100; // ventanas de 10 ms para la energía del audio

// ---------- texto ----------

// "Vídeo," → "video". Para comparar palabras sin mayúsculas, tildes ni signos.
export function normalizeWord(w) {
  return String(w)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

export function tokenize(text) {
  return String(text)
    .replace(/…|\.\.\./g, ' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

const SENTENCE_END = /[.?!…]["»)]*$/;

// ---------- 1. tokens de whisper → palabras ----------

// json: salida de whisper-cli con -ojf (y -dtw). Devuelve [{ w, start, end, p }] en segundos del audio.
// El inicio sale del DTW (t_dtw, en centésimas) si está; si no, del offset del token.
export function wordsFromWhisper(json, offset = 0) {
  const words = [];
  let cur = null;
  let pending = '';
  const flush = () => {
    if (cur && normalizeWord(cur.w)) words.push(cur);
    cur = null;
  };
  for (const seg of json.transcription || []) {
    for (const t of seg.tokens || []) {
      const text = t.text || '';
      if (/^\[_.*\]$/.test(text) || /^<\|.*\|>$/.test(text)) continue; // tokens especiales
      const from = (t.offsets?.from ?? 0) / 1000;
      const to = (t.offsets?.to ?? 0) / 1000;
      const dtw = t.t_dtw != null && t.t_dtw >= 0 ? t.t_dtw / 100 : null;
      const startsWord = /^\s/.test(text) || !cur || pending !== '';
      const isPunct = !normalizeWord(text);
      if (isPunct && /^[¿¡«“"(]+$/.test(text.trim())) {
        pending += text.trim(); // los signos de apertura van con la palabra siguiente
        continue;
      }
      if (isPunct && cur) {
        cur.w += text.trim();
        continue;
      }
      if (startsWord) {
        flush();
        cur = { w: pending + text.trim(), start: dtw ?? from, end: to, p: t.p ?? 1, n: 1, raw: from };
        pending = '';
      } else {
        cur.w += text;
        cur.end = to;
        cur.p = Math.min(cur.p, t.p ?? 1);
        cur.n++;
      }
    }
    // un segmento nuevo siempre empieza palabra nueva
    flush();
  }
  // tiempos crecientes: el DTW a veces devuelve un token un poco antes que el anterior
  let last = -Infinity;
  for (const w of words) {
    w.start = Math.max(w.start, last + 0.01) + offset;
    w.end = Math.max(w.end + offset, w.start + 0.05);
    last = w.start - offset;
    w.raw += offset; // inicio según los offsets de whisper (menos preciso, pero sirve de pista)
    delete w.n;
  }
  for (let i = 0; i < words.length - 1; i++) words[i].end = Math.min(words[i].end, words[i + 1].start);
  for (const w of words) {
    w.start = round(w.start);
    w.end = round(Math.max(w.end, w.start + 0.05));
    w.p = Math.round(w.p * 100) / 100;
  }
  return words;
}

// ---------- 2. energía del audio ----------

// levels: nivel en dB de cada ventana de 10 ms. Devuelve el umbral que separa voz de ruido de fondo:
// un tercio del camino entre el ruido (percentil 10) y la voz (percentil 90), como en los silencios.
export function speechThreshold(levels) {
  const s = Array.from(levels).filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length < 20) return -40;
  const floor = s[Math.floor(s.length * 0.1)];
  const speech = s[Math.floor(s.length * 0.9)];
  return floor + Math.max(6, (speech - floor) / 3);
}

// Máscara de voz (1 = voz) por ventana de 10 ms. Los huecos de menos de `fill` ventanas dentro de la voz
// (oclusivas, p. ej. la "t") se rellenan, y los picos sueltos de menos de `minRun` se quitan.
export function speechMask(levels, threshold = speechThreshold(levels), { fill = 6, minRun = 3 } = {}) {
  const n = levels.length;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = levels[i] > threshold ? 1 : 0;
  // quitar picos sueltos
  for (let i = 0; i < n; ) {
    if (!m[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && m[j]) j++;
    if (j - i < minRun) m.fill(0, i, j);
    i = j;
  }
  // rellenar huecos cortos
  for (let i = 0; i < n; ) {
    if (m[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !m[j]) j++;
    if (i > 0 && j < n && j - i < fill) m.fill(1, i, j);
    i = j;
  }
  return m;
}

// ---------- 3. ajustar las palabras a la voz ----------

// words: [{ w, start, end }] en segundos del archivo; mask: speechMask a FRAME_RATE.
// - Si una palabra empieza en silencio, su inicio avanza hasta donde empieza la voz (máx. 0,6 s).
// - Si empieza en plena voz, retrocede hasta el arranque de esa voz (máx. 0,15 s).
// - El final de cada palabra es donde empieza el primer silencio de al menos `gap` antes de la siguiente: así una
//   pausa no queda "dentro" de la palabra anterior.
// - doubt = true si no hay voz en toda la palabra (posible invención de whisper).
export function refineWords(words, mask, rate = FRAME_RATE, { gap = 0.15 } = {}) {
  const n = mask.length;
  const at = (t) => Math.max(0, Math.min(n - 1, Math.round(t * rate)));
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const prevStart = i > 0 ? out[i - 1].start : 0;
    const floor = i > 0 ? prevStart + 0.08 : 0; // nunca antes que la palabra anterior
    let f = at(w.start);
    let t;
    if (!mask[f]) {
      // en silencio: la voz de esta palabra está justo antes (el DTW llega tarde a veces antes de
      // una pausa) o justo después
      const hi = Math.min(at(w.start + 0.6), at(out[i + 1]?.start ?? Infinity) - 1, n - 1);
      const lo = Math.max(at(floor), at(w.start - 0.5));
      let fwd = f;
      while (fwd < hi && !mask[fwd]) fwd++;
      let back = f;
      while (back > lo && !mask[back]) back--;
      const fwdOk = !!mask[fwd];
      const backOk = !!mask[back] && back > lo;
      if (backOk && (!fwdOk || f - back < fwd - f)) t = Math.max(floor, Math.min(w.raw ?? w.start, back / rate - 0.1));
      else t = fwdOk ? fwd / rate : w.start;
    } else {
      const limit = Math.max(at(w.start - 0.15), at(floor));
      while (f > limit && mask[f - 1]) f--;
      t = f / rate;
    }
    w.start = round(Math.max(t, floor));
  }
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const nextStart = i + 1 < out.length ? out[i + 1].start : Math.max(w.end, w.start + 0.3);
    const hardEnd = Math.min(nextStart, i + 1 < out.length ? nextStart : w.end + 0.6);
    // hacia delante: la palabra acaba donde empieza el primer silencio de al menos `gap` (una
    // respiración o un ruido después de la pausa no cuentan como parte de la palabra)
    const sf = at(w.start);
    const ef = Math.max(sf, at(hardEnd) - 1);
    let speech = false;
    let f = sf;
    let lastSpeech = -1;
    for (; f <= ef; f++) {
      if (mask[f]) {
        speech = true;
        lastSpeech = f;
      } else if (speech && f - lastSpeech >= gap * rate) break;
    }
    const end = speech ? (lastSpeech + 1) / rate : Math.min(hardEnd, w.start + Math.max(0.1, w.end - w.start));
    w.end = round(Math.min(hardEnd, Math.max(end, w.start + 0.05)));
    if (!speech) w.doubt = true;
    else delete w.doubt;
  }
  for (const w of out) delete w.raw;
  return out;
}

// whisper se inventa frases en los silencios largos ("¡Gracias por ver el vídeo!", "(Silencio)"...).
// Se quitan las palabras sin voz que van en grupo (dos o más seguidas) y las anotaciones entre
// paréntesis o corchetes. Una palabra suelta sin voz se queda (puede ser una palabra dicha muy bajo).
export function dropHallucinations(words) {
  // (las cachés antiguas tienen "Pero,¿para": el signo de apertura pasa a la palabra siguiente)
  words = words.map((w) => ({ ...w }));
  for (let i = 0; i < words.length - 1; i++) {
    const m = words[i].w.match(/^(.*[^¿¡«“"(])([¿¡«“"(]+)$/);
    if (m) {
      words[i].w = m[1];
      words[i + 1].w = m[2] + words[i + 1].w;
    }
  }
  return words.filter((w, i) => {
    if (/^[([*].*[)\]*]$/.test(w.w.trim())) return false;
    if (!w.doubt) return true;
    return !(words[i - 1]?.doubt || words[i + 1]?.doubt);
  });
}

// ---------- 4. del archivo fuente al timeline ----------

// Pistas cuya voz se transcribe: las no silenciadas y sin ducking (la música no se transcribe).
export function voiceClips(p) {
  const out = [];
  for (const t of p.tracks) {
    if (t.muted || t.duck || (t.kind === 'video' && t.hidden)) continue; // igual que la exportación
    for (const c of t.clips) {
      const kind = kindOf(c.src);
      const a = p.assets[c.src];
      if ((c.volume ?? 1) <= 0) continue;
      if (kind === 'audio' || (kind === 'video' && a?.hasAudio)) out.push({ track: t, clip: c });
    }
  }
  return out;
}

// sources: { [src]: [{ w, start, end, p, doubt? }] } en segundos del archivo.
// Devuelve las palabras que se oyen en el timeline, ordenadas:
// { i, w, start, end, clip, src, srcStart, srcEnd, p, cut?: 'start'|'end'|'both', doubt? }
// Una palabra entra si su centro cae dentro del clip; `cut` avisa de que el clip la corta.
export function mapToTimeline(p, sources) {
  const words = [];
  for (const { clip } of voiceClips(p)) {
    const list = sources[clip.src];
    if (!list) continue;
    const a = clip.in;
    const b = clip.in + clip.duration;
    for (const w of list) {
      if (w.end <= a || w.start >= b) continue;
      const mid = (w.start + w.end) / 2;
      if (mid < a || mid >= b) continue;
      const s = Math.max(w.start, a);
      const e = Math.min(w.end, b);
      const tw = { w: w.w, start: round(clip.start + (s - a)), end: round(clip.start + (e - a)), clip: clip.id, src: clip.src, srcStart: w.start, srcEnd: w.end, p: w.p };
      const cs = w.start < a - 0.03;
      const ce = w.end > b + 0.03;
      if (cs || ce) tw.cut = cs && ce ? 'both' : cs ? 'start' : 'end';
      if (w.doubt) tw.doubt = true;
      words.push(tw);
    }
  }
  words.sort((x, y) => x.start - y.start);
  words.forEach((w, i) => (w.i = i));
  return words;
}

// Frases: se parte en los puntos (., ?, !, …) y en las pausas largas.
export function buildPhrases(words, { pause = 0.6, maxWords = 40 } = {}) {
  const phrases = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const brk = !next || SENTENCE_END.test(w.w) || next.start - w.end >= pause || i - from + 1 >= maxWords || next.clip !== w.clip && next.start - w.end > 0.3;
    if (brk) {
      phrases.push({ from, to: i, start: words[from].start, end: w.end, text: words.slice(from, i + 1).map((x) => x.w).join(' ') });
      from = i + 1;
    }
  }
  return phrases;
}

// Documento .editor/transcript.json
export function transcriptDoc(p, sources, meta = {}) {
  const words = mapToTimeline(p, sources);
  const phrases = buildPhrases(words);
  return {
    version: 1,
    ...meta,
    duration: words.length ? words[words.length - 1].end : 0,
    text: phrases.map((ph) => ph.text).join('\n'),
    phrases: phrases.map((ph) => ({ start: ph.start, end: ph.end, words: [ph.from, ph.to], text: ph.text })),
    words: words.map((w) => {
      const o = { i: w.i, w: w.w, start: w.start, end: w.end, clip: w.clip, p: w.p };
      if (w.cut) o.cut = w.cut;
      if (w.doubt) o.doubt = true;
      return o;
    }),
  };
}

// ---------- rangos de corte ----------

// Rango del timeline que hay que quitar para borrar las palabras i..j (incluidas) sin tocar las vecinas.
// Deja `padAfter` de cola después de la palabra anterior y `padBefore` antes de la siguiente, como
// los cortes de silencios: así la pausa que queda suena natural. `tight` avisa de que no hay
// silencio donde cortar (el corte podría notarse).
export function cutRangeForWords(words, i, j, { padBefore = 0.1, padAfter = 0.22 } = {}) {
  const first = words[i];
  const last = words[j];
  const prev = words[i - 1];
  const next = words[j + 1];
  let start;
  let end;
  const tight = [];
  if (prev) {
    const gap = first.start - prev.end;
    start = gap > padAfter + 0.02 ? prev.end + padAfter : prev.end + gap / 2;
    if (gap < 0.04) tight.push(prev.end);
  } else start = Math.max(0, first.start - padBefore);
  if (next) {
    const gap = next.start - last.end;
    end = gap > padBefore + 0.02 ? next.start - padBefore : last.end + gap / 2;
    if (gap < 0.04) tight.push(next.start);
  } else end = last.end + padAfter;
  if (prev && next && start > end) start = end;
  return { start: round(start), end: round(Math.max(start, end)), tight };
}

// Junta rangos que se solapan o se tocan.
export function mergeRanges(ranges, gap = 0.001) {
  const r = [...ranges].sort((a, b) => a.start - b.start).map((x) => ({ ...x }));
  const out = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end + gap) last.end = Math.max(last.end, x.end);
    else out.push(x);
  }
  return out;
}

// ---------- buscar texto ----------

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Busca una frase en las palabras. Devuelve [{ i, j, score }] (índices de la primera y la última
// palabra). Tolera algún error de whisper (hasta un 20 % de letras distintas).
export function findText(words, text, { from = 0 } = {}) {
  const q = tokenize(text);
  if (!q.length) return [];
  const qs = q.join('');
  const toks = words.map((w) => normalizeWord(w.w));
  // se compara letra a letra sin espacios: así "click bait" encuentra "clickbait"
  const maxErr = Math.floor(qs.length * 0.2);
  const out = [];
  for (let i = from; i < toks.length; i++) {
    let best = null;
    for (let len = Math.max(1, q.length - 2); len <= q.length + 2 && i + len <= toks.length; len++) {
      const cs = toks.slice(i, i + len).join('');
      if (Math.abs(cs.length - qs.length) > maxErr) continue;
      const d = editDistance(cs, qs);
      if (d <= maxErr && (!best || d < best.score)) best = { i, j: i + len - 1, score: d };
    }
    if (best) out.push(best);
  }
  // sin solapes: el mejor de cada zona
  out.sort((x, y) => x.score - y.score || x.i - y.i);
  const taken = [];
  for (const m of out) if (!taken.some((t) => m.i <= t.j && m.j >= t.i)) taken.push(m);
  return taken.sort((x, y) => x.i - y.i);
}

// "desde…" "hasta…": rango de palabras desde la primera aparición de `fromText` hasta el final de la
// primera aparición de `toText` que venga después. Si no hay `toText`, solo la frase `fromText`.
export function findSpan(words, fromText, toText, { occurrence = 1 } = {}) {
  const starts = findText(words, fromText);
  if (starts.length < occurrence) return null;
  const s = starts[occurrence - 1];
  if (!toText) return { i: s.i, j: s.j, matches: starts.length };
  const ends = findText(words, toText, { from: s.i }).filter((m) => m.j >= s.j || m.i >= s.i);
  if (!ends.length) return null;
  return { i: s.i, j: ends[0].j, matches: starts.length };
}

// ---------- tomas repetidas ----------

const FILLERS = new Set(['eh', 'ehh', 'ehm', 'em', 'emm', 'mm', 'mmm', 'um', 'uh', 'ah', 'aj']);
// palabras con las que una frase no suele acabar: si acaba así y hay pausa, se cortó a medias
const HANGING = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'que', 'y', 'o', 'en', 'a', 'al', 'con', 'por', 'para', 'se', 'lo', 'le', 'mi', 'tu', 'su', 'es', 'como', 'pero', 'porque', 'cuando', 'si', 'muy', 'mas', 'este', 'esta', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'hay']);

function ngrams(toks, n) {
  const out = [];
  for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(' '));
  return out;
}

// Parecido entre dos frases: qué parte de A aparece en B (pares de palabras), y si empiezan igual.
export function phraseSimilarity(a, b) {
  if (!a.length || !b.length) return { contained: 0, samePrefix: 0 };
  const n = a.length >= 3 ? 2 : 1;
  const ga = ngrams(a, n);
  const gb = new Set(ngrams(b, n));
  const contained = ga.filter((g) => gb.has(g)).length / ga.length;
  let samePrefix = 0;
  while (samePrefix < a.length && samePrefix < b.length && a[samePrefix] === b[samePrefix]) samePrefix++;
  return { contained, samePrefix };
}

// Busca en las palabras del timeline:
//  - retake: una frase que se repite poco después (casi igual o empezando igual). Se propone quitar
//    la primera toma (y lo que haya entre las dos).
//  - repeticion: palabras repetidas seguidas ("y bueno, y bueno", "el el").
//  - muletilla: "eh", "mmm"…
//  - cortada: una frase que se queda a medias (acaba en "…" o en "de", "que"… seguida de pausa).
// Cada propuesta lleva el rango del timeline que habría que quitar (ya ajustado a los silencios).
export function findRetakes(words, opts = {}) {
  const { window = 25, lookahead = 3 } = opts;
  const phrases = buildPhrases(words, { pause: opts.pause ?? 0.5 });
  const toks = words.map((w) => normalizeWord(w.w));
  const ptoks = phrases.map((ph) => toks.slice(ph.from, ph.to + 1));
  const found = [];
  const add = (type, i, j, reason, keep) => {
    const r = cutRangeForWords(words, i, j, opts);
    found.push({ type, words: [i, j], start: r.start, end: r.end, tight: r.tight.length > 0, text: words.slice(i, j + 1).map((w) => w.w).join(' '), keep, reason });
  };

  // 1. tomas repetidas (frase A repetida en una frase B posterior)
  const covered = new Set();
  for (let a = 0; a < phrases.length; a++) {
    if (covered.has(a)) continue;
    const A = ptoks[a];
    if (A.length < 2) continue;
    let best = null;
    for (let b = a + 1; b < phrases.length && b <= a + lookahead; b++) {
      if (phrases[b].start - phrases[a].end > window) break;
      const B = ptoks[b];
      const { contained, samePrefix } = phraseSimilarity(A, B);
      const strong = A.length >= 3 && contained >= 0.6 && A.length <= B.length + 2;
      const restart = samePrefix >= Math.min(3, A.length) && samePrefix >= 2;
      if (strong || restart) {
        best = { b, contained, samePrefix };
        break;
      }
    }
    if (!best) continue;
    // si B también se repite después, la buena es la última: se encadenan
    let lastB = best.b;
    for (let guard = 0; guard < 5; guard++) {
      let chained = null;
      for (let c = lastB + 1; c < phrases.length && c <= lastB + lookahead; c++) {
        if (phrases[c].start - phrases[lastB].end > window) break;
        const s = phraseSimilarity(ptoks[lastB], ptoks[c]);
        if ((ptoks[lastB].length >= 3 && s.contained >= 0.6 && ptoks[lastB].length <= ptoks[c].length + 2) || (s.samePrefix >= Math.min(3, ptoks[lastB].length) && s.samePrefix >= 2)) {
          chained = c;
          break;
        }
      }
      if (chained == null) break;
      lastB = chained;
    }
    for (let k = a; k < lastB; k++) covered.add(k);
    const keep = phrases[lastB];
    const why = best.samePrefix >= 2 ? `empieza igual que la toma de ${keep.start.toFixed(1)}s` : `se repite en ${keep.start.toFixed(1)}s (${Math.round(best.contained * 100)} % igual)`;
    add('retake', phrases[a].from, keep.from - 1, `Toma repetida: ${why}`, { start: keep.start, text: keep.text });
  }
  const inRetake = (i) => found.some((f) => f.type === 'retake' && i >= f.words[0] && i <= f.words[1]);

  // 2. palabras repetidas seguidas
  for (let i = 0; i < toks.length; i++) {
    if (inRetake(i)) continue;
    for (let n = 4; n >= 1; n--) {
      if (i + 2 * n > toks.length) continue;
      let same = true;
      for (let k = 0; k < n; k++) if (toks[i + k] !== toks[i + n + k] || !toks[i + k]) same = false;
      if (!same) continue;
      if (words[i + n].start - words[i + n - 1].end > 1.5) continue;
      if (n === 1 && toks[i].length > 0 && ['si', 'no', 'muy', 'ya'].includes(toks[i])) continue; // "no, no" suele ser intencionado
      add('repeticion', i, i + n - 1, `Repetido: "${words.slice(i, i + n).map((w) => w.w).join(' ')}"`);
      i += 2 * n - 1;
      break;
    }
  }

  // 3. muletillas
  for (let i = 0; i < toks.length; i++) if (FILLERS.has(toks[i]) && !inRetake(i)) add('muletilla', i, i, `Muletilla: "${words[i].w}"`);

  // 4. frases cortadas
  for (let k = 0; k < phrases.length - 1; k++) {
    const ph = phrases[k];
    if (inRetake(ph.to)) continue;
    const lastWord = words[ph.to].w;
    const lastTok = toks[ph.to];
    const pauseAfter = phrases[k + 1].start - ph.end;
    // si lo siguiente empieza en minúscula, la frase sigue (es una pausa, no un corte)
    const nextWord = words[phrases[k + 1].from].w.replace(/^[¿¡«"(]+/, '');
    if (/^\p{Ll}/u.test(nextWord)) continue;
    // whisper también pone "..." en las pausas dramáticas: solo cuenta en frases cortas
    const dots = /…|\.\.\.$/.test(lastWord) && ph.to - ph.from < 4;
    if (dots || (HANGING.has(lastTok) && pauseAfter >= 0.5 && !SENTENCE_END.test(lastWord))) {
      add('cortada', ph.from, ph.to, `Frase a medias: acaba en "${lastWord}"`);
    }
  }
  return found.sort((x, y) => x.start - y.start);
}

// ---------- comparar transcripciones (verify) ----------

// Alinea las palabras esperadas (del montaje, según la transcripción de los originales) con las que
// se oyen al volver a transcribir el montaje. Devuelve los tramos donde no coinciden.
export function diffWords(expected, heard, { maxGap = 3 } = {}) {
  const A = expected.map((w) => normalizeWord(w.w));
  const B = heard.map((w) => normalizeWord(w.w));
  const n = A.length;
  const m = B.length;
  // LCS con programación dinámica (en filas para no gastar memoria de más)
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const diffs = [];
  let i = 0;
  let j = 0;
  let cur = null;
  const close = () => {
    if (cur) diffs.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      close();
      i++;
      j++;
    } else {
      cur = cur || { expected: [], heard: [], start: Infinity, end: -Infinity };
      if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        cur.heard.push(heard[j].w);
        cur.start = Math.min(cur.start, heard[j].start);
        cur.end = Math.max(cur.end, heard[j].end);
        j++;
      } else {
        cur.expected.push(expected[i].w);
        cur.start = Math.min(cur.start, expected[i].start);
        cur.end = Math.max(cur.end, expected[i].end);
        i++;
      }
    }
  }
  close();
  // pequeñas diferencias de una palabra suelen ser errores de whisper: se marcan como leves
  return diffs.map((d) => ({ ...d, minor: d.expected.length + d.heard.length <= 2 && Math.max(d.expected.length, d.heard.length) <= 1, big: d.expected.length > maxGap || d.heard.length > maxGap }));
}

// Problemas de los cortes del montaje: palabras partidas y cortes sin silencio.
export function cutProblems(p, words) {
  const problems = [];
  for (const w of words) {
    if (w.cut) problems.push({ type: 'palabra-cortada', start: w.start, end: w.end, text: w.w, reason: `El corte parte la palabra "${w.w}" (${w.cut === 'start' ? 'por el principio' : w.cut === 'end' ? 'por el final' : 'por los dos lados'})` });
  }
  // cortes (fin de un clip de voz seguido de otro) sin pausa a los lados
  const clips = voiceClips(p).map((x) => x.clip).sort((a, b) => a.start - b.start);
  for (let k = 0; k < clips.length - 1; k++) {
    const t = clipEnd(clips[k]);
    if (Math.abs(clips[k + 1].start - t) > 0.05) continue;
    const before = words.filter((w) => w.clip === clips[k].id).pop();
    const after = words.find((w) => w.clip === clips[k + 1].id);
    if (before && t - before.end < 0.04 && !before.cut) problems.push({ type: 'corte-justo', start: before.start, end: t, text: before.w, reason: `Corte pegado al final de "${before.w}" en ${t.toFixed(2)}s: puede comerse el final` });
    if (after && after.start - t < 0.03 && !after.cut) problems.push({ type: 'corte-justo', start: t, end: after.end, text: after.w, reason: `Corte pegado al inicio de "${after.w}" en ${t.toFixed(2)}s` });
  }
  return problems.sort((a, b) => a.start - b.start);
}
