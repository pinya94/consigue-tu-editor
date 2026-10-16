// Animaciones desde un guion anclado a la transcripción. Operaciones puras (sin Node ni DOM).
//
// El guion (media/kit/guion.mjs de cada proyecto) es una lista de entradas:
//   { id, kind: 'escena' | 'rotulo', from: 'palabras que se dicen', to?: 'palabras', html: (h) => '…' }
// from / to también pueden ser un segundo exacto. Opcionales: after (buscar a partir de ese segundo),
// lead / tail (margen antes y después), min (duración mínima), dur (duración fija).
// Cada entrada se coloca donde se dicen esas palabras, así que si el montaje cambia basta con
// volver a generar. Las escenas (pantalla completa) mandan: los rótulos que las pisan se recortan.
// html(h) recibe las piezas del kit (h.kin, h.side, h.ring…), h.dur (duración) y h.t('palabras'):
// el segundo, desde el inicio de la animación, en que se dicen esas palabras.

// ---------- búsqueda de palabras ----------

// Palabras que whisper suele escribir mal (se comparan ya normalizadas).
export const DEFAULT_ALIASES = { cloude: 'claude', cloud: 'claude', claudi: 'claude', clode: 'claude' };

// "¿Vídeo, CapCut?" → "video capcut": sin mayúsculas, tildes ni signos.
export function normText(s, aliases = DEFAULT_ALIASES) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => aliases[w] || w);
}

// Índice para buscar: cada trozo normalizado sabe de qué palabra viene.
export function wordIndex(words, aliases = DEFAULT_ALIASES) {
  const toks = [];
  const of = [];
  words.forEach((w, i) => {
    for (const t of normText(w.w, aliases)) {
      toks.push(t);
      of.push(i);
    }
  });
  return { words, toks, of, aliases };
}

function findExact(idx, q, after) {
  const { words, toks, of } = idx;
  for (let i = 0; i + q.length <= toks.length; i++) {
    if (words[of[i]].start < after - 0.01) continue;
    let ok = true;
    for (let k = 0; k < q.length && ok; k++) ok = toks[i + k] === q[k];
    if (ok) return { start: words[of[i]].start, end: words[of[i + q.length - 1]].end, word: of[i], lastWord: of[i + q.length - 1] };
  }
  return null;
}

// Busca un texto en la transcripción a partir del segundo `after`. Si un corte se ha llevado alguna
// palabra, prueba con menos: las primeras para un inicio (side 'from') o las últimas para un final
// (side 'to'), sin bajar de dos. Devuelve { start, end, word, lastWord, used } o null.
export function findAnchor(idx, text, { after = 0, side = 'from' } = {}) {
  const q = normText(text, idx.aliases);
  if (!q.length) return null;
  for (let n = q.length; n >= Math.min(2, q.length); n--) {
    const part = side === 'to' ? q.slice(q.length - n) : q.slice(0, n);
    const r = findExact(idx, part, after);
    if (r) return { ...r, used: n };
  }
  return null;
}

function anchor(idx, x, after, side) {
  if (typeof x === 'number') return { start: x, end: x };
  const r = findAnchor(idx, x, { after, side });
  if (!r) throw new Error(`No encuentro en la transcripción: "${x}"`);
  return r;
}

// ---------- colocación ----------

// Dónde cae cada entrada del guion. Devuelve { placed: [{ g, start, end, t }], skipped: [{ g, reason }] }.
// Las escenas mandan sobre los rótulos, los rótulos no se pisan entre sí y los que se quedan en
// menos de `minLabel` segundos se descartan.
export function layoutGuion(guion, words, { total = Infinity, aliases, minLabel = 1.2 } = {}) {
  const idx = wordIndex(words, aliases);
  const placed = [];
  const skipped = [];
  for (const g of guion) {
    let a, b;
    try {
      a = anchor(idx, g.from, g.after ?? 0, 'from');
      b = g.to != null ? anchor(idx, g.to, a.start, 'to') : a;
    } catch (e) {
      skipped.push({ g, reason: e.message });
      continue;
    }
    const start = Math.max(0, a.start - (g.lead ?? (g.kind === 'escena' ? 0.6 : 0.2)));
    let end = Math.min(total, Math.max(b.end + (g.tail ?? 0.35), start + (g.min ?? 2.2)));
    if (g.dur) end = Math.min(total, start + g.dur);
    // segundo (desde el inicio de la animación) en que se dice algo: para sincronizar por dentro
    const item = { g, start, end };
    // (se calcula con el inicio final, por si una escena ha retrasado el rótulo)
    item.t = (text, after) => {
      const r = findAnchor(idx, text, { after: after ?? a.start });
      if (!r) throw new Error(`No encuentro en la transcripción: "${text}"`);
      return +Math.max(0, r.start - item.start).toFixed(2);
    };
    placed.push(item);
  }
  const scenes = placed.filter((x) => x.g.kind === 'escena');
  const labels = placed.filter((x) => x.g.kind !== 'escena').sort((x, y) => x.start - y.start);
  for (const l of labels) {
    for (const s of scenes) {
      if (l.start < s.end && l.end > s.start) {
        if (l.start < s.start) l.end = Math.min(l.end, s.start - 0.1);
        else l.start = s.end + 0.1;
      }
    }
  }
  for (let i = 1; i < labels.length; i++) if (labels[i - 1].end > labels[i].start - 0.1) labels[i - 1].end = labels[i].start - 0.1;
  for (const l of labels) if (l.end - l.start < minLabel) skipped.push({ g: l.g, reason: 'se queda sin sitio (la pisa una escena u otro rótulo)' });
  const keep = [...scenes, ...labels.filter((l) => l.end - l.start >= minLabel)].sort((x, y) => x.start - y.start);
  for (const x of keep) {
    x.start = +x.start.toFixed(3);
    x.end = +x.end.toFixed(3);
    x.dur = +(x.end - x.start).toFixed(3);
  }
  return { placed: keep, skipped };
}

// Marca de los HTML generados: solo esos se borran cuando ya no están en el guion.
export const GENERATED_MARK = '<meta name="generator" content="editor animate">';

// HTML completo de una animación de `dur` segundos (media/anim/<id>.html, con el kit en media/kit/).
export function animationPage(body, dur) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="animation-duration" content="${dur}">${GENERATED_MARK}
<link rel="stylesheet" href="../kit/kit.css"><script src="../kit/kit.js"></script></head>
<body><div class="root" style="--out:${Math.max(0.5, dur - 0.45).toFixed(2)}s">${body}</div></body></html>`;
}

// ---------- piezas de HTML ----------
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Texto que entra palabra a palabra desde abajo (con máscara)
// *una o varias palabras* salen en el color de acento
export const words_ = (text, d = 0, step = 0.06) => {
  let accent = false;
  return text.split(' ').map((w, i) => {
    const opens = w.startsWith('*');
    const m = w.replace(/^\*/, '').match(/^(.*?)(\*?)([.,:;!?…]*)$/);
    const on = accent || opens;
    if (opens) accent = true;
    if (m[2]) accent = false;
    const inner = on ? `<span class="acc">${m[1]}</span>${m[3]}` : m[1] + m[3];
    return `<span class="mask"><span class="w" style="--d:${(d + i * step).toFixed(2)}s">${inner}</span></span>`;
  }).join(' ');
};

export const ICONS = {
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5M12 6v2M12 16v2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
  win: '<path d="M3 5.5l7.5-1v7H3zM12 4.3L21 3v8.5h-9zM3 12.5h7.5v7L3 18.5zM12 12.5h9V21l-9-1.3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-11 7"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.6-4.8-4-5.6"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/>',
};
export const icon = (name, size = 26) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg>`;

// El bichito: un muñeco de píxeles naranja (homenaje a la mascota de Claude Code).
const PIX = [
  '...########...',
  '..##########..',
  '.############.',
  '.###EE###EE##.',
  'A###EE###EE##B',
  'A############B',
  '.############.',
  '.##.##..##.##.',
  '.##.##..##.##.',
];
// mood: 'jump' (salta), 'think' (bocadillo con `say`), 'love' (corazones), 'sweat' (gotas)
export function bicho({ x, y, scale = 1, wave = false, d = 0, flip = false, mood, say = '…' } = {}) {
  const px = 10;
  let body = '', eyes = '', armL = '', armR = '';
  PIX.forEach((row, r) => [...row].forEach((ch, c) => {
    const rect = (fill) => `<rect x="${c * px}" y="${r * px}" width="${px + 0.5}" height="${px + 0.5}" fill="${fill}"/>`;
    if (ch === '#') body += rect('#d97757');
    else if (ch === 'E') eyes += rect('#1a1410');
    else if (ch === 'A') armL += rect('#c4673f');
    else if (ch === 'B') armR += rect('#c4673f');
  }));
  const w = PIX[0].length * px, h = PIX.length * px;
  const W = w * scale, H = h * scale;
  let extra = '';
  if (mood === 'think') extra = `<div class="think pop" style="--d:${d + 0.4}s">${say}</div>`;
  if (mood === 'love') extra = [0, 0.5, 1].map((k, i) => `<span class="heart" style="--d:${d + 0.3 + k}s;left:${W * (0.2 + i * 0.3)}px;top:-10px">♥</span>`).join('');
  if (mood === 'sweat') extra = [0, 0.6].map((k, i) => `<span class="drop" style="--d:${d + 0.3 + k}s;left:${W * (0.85 + i * 0.08)}px;top:${H * 0.1}px"></span>`).join('');
  return `<div class="bicho pop ${mood === 'jump' ? 'jump' : ''}" style="--d:${d}s;left:${x}px;top:${y}px;width:${W}px;height:${H}px;${flip ? 'transform:scaleX(-1)' : ''}">
<svg viewBox="0 0 ${w} ${h}"><g class="body">${body}${armL}<g class="${wave ? 'arm' : ''}">${armR}</g><g class="eyes">${eyes}</g></g></svg>${extra}</div>`;
}

// Frase grande sin caja, palabra a palabra. [palabra] = resaltada con rotulador.
// at: { left|right, top } en píxeles; size: 'small' para frases largas.
export function kin(text, { x, y, right, d = 0.1, step = 0.09, small = false, sub, width = 760, align } = {}) {
  let i = 0;
  const html = text.split(/(\[[^\]]+\])/).filter(Boolean).map((chunk) => {
    const mk = chunk.startsWith('[');
    return chunk.replace(/^\[|\]$/g, '').split(' ').filter(Boolean)
      .map((w) => `<span class="pw${mk ? ' mk' : ''}" style="--d:${(d + i++ * step).toFixed(2)}s">${w}</span>`).join(' ');
  }).join(' ');
  const pos = right != null ? `right:${right}px` : `left:${x}px`;
  return `<div class="kin${small ? ' small' : ''}" style="${pos};top:${y}px;width:${width}px;${align ? `text-align:${align}` : ''}">${html}${sub ? `<span class="sub fade" style="--d:${(d + i * step + 0.2).toFixed(2)}s">${sub}</span>` : ''}</div>`;
}

// Cifra grande dentro de un anillo que se dibuja. frac = parte del anillo (0-1).
export function ring({ x, y, from = 0, to, prefix = '', suffix = '', label, d = 0.2, frac = 1, color, size = 360 }) {
  const r = 160, c = 2 * Math.PI * r;
  return `<div class="ring pop" style="--d:${d}s;left:${x}px;top:${y}px;width:${size}px;height:${size}px">
<svg viewBox="0 0 360 360"><circle class="track" cx="180" cy="180" r="${r}"/><circle class="arc" cx="180" cy="180" r="${r}" style="--d:${d + 0.2}s;stroke-dasharray:${c};stroke-dashoffset:${c};--to:${c * (1 - frac)};${color ? `stroke:${color}` : ''}"/></svg>
<div><div class="val"><span data-count data-from="${from}" data-to="${to}" data-at="${d + 0.2}" data-dur="1.3" data-prefix="${prefix}" data-suffix="${suffix}"></span></div>${label ? `<div class="lab">${label}</div>` : ''}</div></div>`;
}

// Fila de iconos que se dibujan solos, sin caja. items: [{ icon, text, d }]
export function badges(items, { x, y, right, gap = 30 } = {}) {
  const pos = right != null ? `right:${right}px` : `left:${x}px`;
  return `<div class="at row-flex" style="${pos};top:${y}px;gap:${gap}px">${items.map((it) =>
    `<div class="badge pop" style="--d:${it.d}s"><div class="disc draw" style="--d:${it.d + 0.1}s">${icon(it.icon, 58)}</div><div class="lbl">${it.text}</div></div>`).join('')}</div>`;
}

// Cursor que llega y hace clic (con onda)
export function cursor({ x, y, d = 0.3, from = [-160, 120] }) {
  return `<div class="cursor" style="--d:${d}s;left:${x}px;top:${y}px;--fx:${from[0]}px;--fy:${from[1]}px"><svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
<div class="ripple" style="--d:${d + 1}s;left:${x + 6}px;top:${y + 6}px"></div>`;
}

// Fichas que suben (p. ej. "+1.500")
export const chipsUp = (text, { x, y, d = 0.3, n = 4, every = 0.45, spread = 60 }) =>
  Array.from({ length: n }, (_, i) => `<div class="chip-up" style="--d:${(d + i * every).toFixed(2)}s;left:${x + ((i * 37) % spread) - spread / 2}px;top:${y}px">${text}</div>`).join('');

// Confeti que estalla desde (x, y)
export function confetti({ x, y, d = 0.3, n = 34 }) {
  const colors = ['#e07b53', '#f2b582', '#6fcf8e', '#7aa7ff', '#ffffff', '#ff5c7a'];
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.3, dist = 180 + ((i * 53) % 220);
    s += `<i style="--d:${d}s;left:${x}px;top:${y}px;background:${colors[i % colors.length]};--x:${Math.round(Math.cos(a) * dist)}px;--y:${Math.round(Math.sin(a) * dist + 160)}px;--r:${(i * 97) % 720 - 360}deg"></i>`;
  }
  return `<div class="confetti">${s}</div>`;
}

// Sello grande inclinado ("GRATIS", "NO")
export const stamp = (text, { x, y, d = 0.3, good = false }) => `<div class="stamp${good ? ' good' : ''}" style="--d:${d}s;left:${x}px;top:${y}px">${text}</div>`;

// Ventana flotante con contenido
export const win = (title, html, { x, y, w, h, d = 0.2 }) =>
  `<div class="win float-in" style="--d:${d}s;left:${x}px;top:${y}px;width:${w}px;height:${h}px"><div class="bar"><i></i><i></i><i></i><b>${title}</b></div>${html}</div>`;

// Rótulo lateral estándar
export function side({ side: s = 'r', kicker, title, text, rows = [], d = 0.1, iconName, width }) {
  const cls = s === 'l' ? 'slide-l' : 'slide-r';
  return `<div class="side ${s} panel ${cls}" style="--d:${d}s;${width ? `width:${width}px` : ''}"><div class="bar"></div>
${kicker ? `<div class="kicker fade" style="--d:${d + 0.15}s">${kicker}</div>` : ''}
${title ? `<div class="h3">${iconName ? `<span class="ico" style="display:inline-grid;vertical-align:middle;margin-right:14px">${icon(iconName)}</span>` : ''}${words_(title, d + 0.25)}</div>` : ''}
${text ? `<div class="p fade" style="--d:${d + 0.6}s">${text}</div>` : ''}
${rows.length ? `<div class="rows">${rows.map((r, i) => `<div class="row rise" style="--d:${(r.d ?? d + 0.6 + i * 0.35).toFixed(2)}s"><span class="ico">${icon(r.icon || 'check')}</span><span>${r.text}</span></div>`).join('')}</div>` : ''}
</div>`;
}

// Piezas que recibe cada animación del guion como h.<pieza>.
export const pieces = { words: words_, icon, bicho, side, esc, kin, ring, badges, cursor, chipsUp, confetti, stamp, win };
