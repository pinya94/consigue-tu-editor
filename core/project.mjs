// Formato de proyecto y operaciones puras sobre él.
// Este módulo no usa Node ni el DOM: lo comparten la app (renderer), el proceso principal y la CLI.
//
// Un proyecto (proyecto.json) tiene esta forma:
// {
//   version: 1, name, width, height, fps,
//   assets: { "<src>": { kind, duration, width, height, hasAudio } },   // metadatos cacheados
//   tracks: [   // de abajo a arriba: la última pista se pinta encima
//     { id, kind: "video" | "audio", name, muted?, hidden?, duck?,
//       clips: [ { id, src, start, in, duration, volume?, fit?, zoom?, zoomX?, zoomY?, zoomTo?, zoomTime? } ] }
//   ]
// }
// Tiempos en segundos. start = posición en el timeline, in = desde qué segundo del archivo fuente.
// zoom: 1 = normal, 1.2 = acercamiento del 20 %; zoomX/zoomY (0-1) = punto hacia el que se acerca.
// zoomTo/zoomTime: zoom animado (de zoom a zoomTo en zoomTime s). duck (pista de audio): baja cuando se habla.

export const PROJECT_FILE = 'proyecto.json';
export const VERSION = 1;

export const EXT_KIND = {
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  html: 'html', htm: 'html',
};

// Duración por defecto de imágenes y animaciones sin duración declarada.
export const DEFAULT_STILL_DURATION = 5;

export function kindOf(src) {
  const ext = String(src).split('.').pop().toLowerCase();
  return EXT_KIND[ext] || null;
}

export function trackKindFor(kind) {
  return kind === 'audio' ? 'audio' : 'video';
}

export function round(t) {
  return Math.round(t * 1000) / 1000;
}

export function snapToFrame(p, t) {
  return round(Math.round(t * p.fps) / p.fps);
}

export function clone(p) {
  return JSON.parse(JSON.stringify(p));
}

export function createProject({ name = 'Proyecto', width = 1920, height = 1080, fps = 30 } = {}) {
  return {
    version: VERSION,
    name,
    width,
    height,
    fps,
    assets: {},
    tracks: [
      { id: 'v1', kind: 'video', name: 'Vídeo 1', clips: [] },
      { id: 'v2', kind: 'video', name: 'Animaciones', clips: [] },
      { id: 'a1', kind: 'audio', name: 'Audio 1', clips: [] },
    ],
  };
}

export function clipEnd(c) {
  return round(c.start + c.duration);
}

export function allClips(p) {
  return p.tracks.flatMap((t) => t.clips);
}

export function totalDuration(p) {
  return allClips(p).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function findClip(p, id) {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const ci = p.tracks[ti].clips.findIndex((c) => c.id === id);
    if (ci >= 0) return { track: p.tracks[ti], clip: p.tracks[ti].clips[ci], ti, ci };
  }
  return null;
}

export function findTrack(p, id) {
  return p.tracks.find((t) => t.id === id) || null;
}

function mustClip(p, id) {
  const f = findClip(p, id);
  if (!f) throw new Error(`No existe el clip "${id}"`);
  return f;
}

function mustTrack(p, id) {
  const t = findTrack(p, id);
  if (!t) throw new Error(`No existe la pista "${id}"`);
  return t;
}

export function nextId(p, prefix) {
  const used = new Set([...p.tracks.map((t) => t.id), ...allClips(p).map((c) => c.id)]);
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

// Duración total del archivo fuente, o Infinity si se puede estirar (imagen, animación sin duración).
export function sourceDuration(p, src) {
  const a = p.assets[src];
  if (!a || a.duration == null) return Infinity;
  return a.duration;
}

export function sortClips(track) {
  track.clips.sort((a, b) => a.start - b.start);
}

// Clips activos en el instante t, por pista (de abajo a arriba).
export function activeClipsAt(p, t) {
  const out = [];
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => t >= c.start && t < clipEnd(c));
    if (clip) out.push({ track, clip });
  }
  return out;
}

// Al partir un clip con zoom animado, cada trozo sigue la misma animación en vez de repetirla.
// Devuelve los cambios de zoom del trozo que empieza `offset` segundos después del inicio del clip.
function zoomAfter(c, offset) {
  if (c.zoomTo == null) return {};
  const T = c.zoomTime > 0 ? c.zoomTime : c.duration;
  if (offset >= T) return { zoom: c.zoomTo, zoomTo: undefined, zoomTime: undefined };
  return { zoom: Math.round(zoomAt(c, offset) * 1000) / 1000, zoomTime: round(T - offset) };
}
// El trozo de la izquierda conserva la duración de la animación original.
function zoomBefore(c) {
  return c.zoomTo != null && !(c.zoomTime > 0) ? { zoomTime: c.duration } : {};
}

// Deja libre el rango [from, to) de una pista recortando o partiendo los clips que lo pisan.
function clearRange(p, track, from, to, exceptId) {
  const result = [];
  for (const c of track.clips) {
    const end = clipEnd(c);
    if (c.id === exceptId || end <= from || c.start >= to) {
      result.push(c);
      continue;
    }
    if (c.start < from) {
      const left = { ...c, ...zoomBefore(c), duration: round(from - c.start) };
      result.push(left);
      if (end > to) {
        // el id nuevo tiene que ser único también frente a los clips ya recolocados en `result`
        const right = { ...c, ...zoomAfter(c, to - c.start), id: nextId({ tracks: [...p.tracks, { clips: result }] }, 'c'), start: to, in: round(c.in + (to - c.start)), duration: round(end - to) };
        result.push(right);
      }
    } else if (end > to) {
      result.push({ ...c, ...zoomAfter(c, to - c.start), start: to, in: round(c.in + (to - c.start)), duration: round(end - to) });
    }
    // si está entero dentro del rango, desaparece
  }
  track.clips = result.filter((c) => c.duration > 0.0005);
  sortClips(track);
}

// ---------- Operaciones (todas devuelven un proyecto nuevo) ----------

export function addTrack(p0, kind = 'video', name) {
  const p = clone(p0);
  const id = nextId(p, kind === 'audio' ? 'a' : 'v');
  const track = { id, kind, name: name || (kind === 'audio' ? 'Audio' : 'Vídeo') + ' ' + id.slice(1), clips: [] };
  if (kind === 'audio') p.tracks.push(track);
  else {
    // las pistas de vídeo van antes que las de audio
    const firstAudio = p.tracks.findIndex((t) => t.kind === 'audio');
    p.tracks.splice(firstAudio < 0 ? p.tracks.length : firstAudio, 0, track);
  }
  return { project: p, trackId: id };
}

export function removeTrack(p0, trackId) {
  const p = clone(p0);
  mustTrack(p, trackId);
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  return p;
}

export function updateTrack(p0, trackId, patch) {
  const p = clone(p0);
  Object.assign(mustTrack(p, trackId), patch);
  return p;
}

// Añade un clip. Si no se indica pista se usa la primera compatible; si no se indica start, al final de la pista.
export function addClip(p0, { src, trackId, start, in: inPoint = 0, duration, volume, fit }) {
  const p = clone(p0);
  const kind = kindOf(src);
  if (!kind) throw new Error(`Tipo de archivo no soportado: ${src}`);
  const tk = trackKindFor(kind);
  let track = trackId ? mustTrack(p, trackId) : p.tracks.find((t) => t.kind === tk);
  if (!track) {
    const r = addTrack(p, tk);
    Object.assign(p, r.project);
    track = findTrack(p, r.trackId);
  }
  if (track.kind !== tk) throw new Error(`Un archivo de tipo ${kind} no puede ir en una pista de ${track.kind}`);
  const srcDur = sourceDuration(p, src);
  const a = p.assets[src];
  const natural = a && a.duration != null ? a.duration : DEFAULT_STILL_DURATION;
  let dur = duration != null ? duration : natural - inPoint;
  if (Number.isFinite(srcDur)) dur = Math.min(dur, srcDur - inPoint);
  if (!(dur > 0)) throw new Error('La duración del clip debe ser mayor que 0');
  const s = start != null ? start : track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip = { id: nextId(p, 'c'), src, start: round(Math.max(0, s)), in: round(inPoint), duration: round(dur) };
  if (volume != null) clip.volume = volume;
  if (fit) clip.fit = fit;
  // se mete antes de despejar el hueco para que los ids nuevos que salgan de partir otros clips no choquen con el suyo
  track.clips.push(clip);
  clearRange(p, track, clip.start, clipEnd(clip), clip.id);
  return { project: p, clipId: clip.id };
}

// Parte un clip en el instante t (tiempo del timeline). Devuelve el id de la segunda mitad.
export function splitClip(p0, clipId, t) {
  const p = clone(p0);
  const { track, clip } = mustClip(p, clipId);
  t = snapToFrame(p, t);
  if (t <= clip.start || t >= clipEnd(clip)) return { project: p0, newId: null };
  const second = { ...clip, ...zoomAfter(clip, t - clip.start), id: nextId(p, 'c'), start: t, in: round(clip.in + (t - clip.start)), duration: round(clipEnd(clip) - t) };
  Object.assign(clip, zoomBefore(clip));
  clip.duration = round(t - clip.start);
  track.clips.push(second);
  sortClips(track);
  return { project: p, newId: second.id };
}

// Parte todos los clips que están bajo el instante t (opcionalmente solo en ciertas pistas).
export function splitAt(p0, t, trackIds) {
  let p = p0;
  for (const track of p0.tracks) {
    if (trackIds && !trackIds.includes(track.id)) continue;
    for (const c of track.clips) {
      if (t > c.start && t < clipEnd(c)) p = splitClip(p, c.id, t).project;
    }
  }
  return p;
}

// Cambia los bordes de un clip en tiempo de timeline. Respeta los límites del archivo fuente.
export function trimClip(p0, clipId, { start, end }) {
  const p = clone(p0);
  const { track, clip } = mustClip(p, clipId);
  const srcDur = sourceDuration(p, clip.src);
  const oldEnd = clipEnd(clip);
  let newStart = start != null ? start : clip.start;
  let newEnd = end != null ? end : oldEnd;
  // límite izquierdo: no se puede empezar antes del segundo 0 de la fuente ni del 0 del timeline
  const minStart = Math.max(0, clip.start - clip.in);
  newStart = Math.max(newStart, minStart);
  // límite derecho: final de la fuente
  const maxEnd = clip.start - clip.in + srcDur;
  newEnd = Math.min(newEnd, maxEnd);
  const minLen = 1 / p.fps;
  if (newEnd - newStart < minLen) {
    if (start != null) newStart = newEnd - minLen;
    else newEnd = newStart + minLen;
  }
  clip.in = round(clip.in + (newStart - clip.start));
  clip.start = round(newStart);
  clip.duration = round(newEnd - newStart);
  clearRange(p, track, clip.start, clipEnd(clip), clip.id);
  return p;
}

// Mueve un clip a otra posición (y opcionalmente a otra pista). Lo que pise queda sobrescrito.
export function moveClip(p0, clipId, newStart, newTrackId) {
  const p = clone(p0);
  const { track, clip } = mustClip(p, clipId);
  let dest = track;
  if (newTrackId && newTrackId !== track.id) {
    dest = mustTrack(p, newTrackId);
    if (dest.kind !== track.kind) throw new Error('No se puede mover un clip a una pista de otro tipo');
    track.clips = track.clips.filter((c) => c.id !== clipId);
    dest.clips.push(clip);
  }
  clip.start = round(Math.max(0, newStart));
  clearRange(p, dest, clip.start, clipEnd(clip), clip.id);
  sortClips(dest);
  return p;
}

export function updateClip(p0, clipId, patch) {
  let p = clone(p0);
  const { clip } = mustClip(p, clipId);
  const { start, duration, in: inPoint, ...rest } = patch;
  Object.assign(clip, rest);
  if (inPoint != null) {
    const srcDur = sourceDuration(p, clip.src);
    clip.in = round(Math.max(0, Math.min(inPoint, srcDur - 1 / p.fps)));
    if (Number.isFinite(srcDur)) clip.duration = round(Math.min(clip.duration, srcDur - clip.in));
  }
  if (duration != null) p = trimClip(p, clipId, { end: clip.start + duration });
  if (start != null) p = moveClip(p, clipId, start);
  return p;
}

// Borra clips. Con ripple, los clips posteriores de la misma pista se desplazan para tapar el hueco.
export function deleteClips(p0, clipIds, { ripple = false } = {}) {
  const p = clone(p0);
  for (const id of clipIds) {
    const f = findClip(p, id);
    if (!f) continue;
    const { track, clip } = f;
    track.clips = track.clips.filter((c) => c.id !== id);
    if (ripple) {
      for (const c of track.clips) if (c.start >= clipEnd(clip) - 0.0005) c.start = round(c.start - clip.duration);
    }
  }
  return p;
}

// Elimina rangos (en tiempo de timeline) dentro de un clip y cierra los huecos en esa pista.
// Se usa para quitar silencios. Los rangos se procesan de derecha a izquierda.
export function removeRanges(p0, clipId, ranges) {
  let p = p0;
  const { track } = mustClip(p, clipId);
  const trackId = track.id;
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const from = snapToFrame(p, r.start);
    const to = snapToFrame(p, r.end);
    if (to - from < 1 / p.fps) continue;
    p = clone(p);
    const t = findTrack(p, trackId);
    clearRange(p, t, from, to);
    const len = to - from;
    for (const c of t.clips) if (c.start >= to - 0.0005) c.start = round(c.start - len);
    sortClips(t);
  }
  return dropSlivers(p);
}

// Quita los restos de menos de medio fotograma que dejan los redondeos al cortar,
// y adelanta lo que va detrás para no dejar huecos.
export function dropSlivers(p0) {
  const min = 0.5 / p0.fps;
  if (!p0.tracks.some((t) => t.clips.some((c) => c.duration < min))) return p0;
  const p = clone(p0);
  for (const t of p.tracks) {
    sortClips(t);
    let shift = 0;
    t.clips = t.clips.filter((c) => {
      if (c.duration < min) {
        shift += c.duration;
        return false;
      }
      if (shift) c.start = round(c.start - shift);
      return true;
    });
  }
  return p;
}

// Quita rangos del timeline en todas las pistas y cierra los huecos (como borrar con ripple).
// Se usa para los cortes por texto: todo lo que va detrás se adelanta a la vez, así que las
// animaciones siguen cayendo sobre la misma frase. Las imágenes, las animaciones y los clips de una
// pista con ducking (música) no se parten: se acortan, para que no salten a mitad.
export function removeTimeRanges(p0, ranges) {
  let p = clone(p0);
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const from = snapToFrame(p, r.start);
    const to = snapToFrame(p, r.end);
    const len = round(to - from);
    if (len < 1 / p.fps) continue;
    for (const t of p.tracks) {
      const elastic = (c) => t.duck || kindOf(c.src) === 'html' || kindOf(c.src) === 'image';
      const soft = [];
      for (const c of t.clips.filter(elastic)) {
        const end = clipEnd(c);
        if (end <= from + 0.0005) soft.push(c);
        else if (c.start >= to - 0.0005) soft.push({ ...c, start: round(c.start - len) });
        else {
          // solapa con el rango: pierde la parte solapada sin partirse
          const overlap = Math.min(end, to) - Math.max(c.start, from);
          const d = round(c.duration - overlap);
          if (d > 0.0005) soft.push({ ...c, start: round(Math.min(c.start, from)), duration: d });
        }
      }
      // el resto se parte por los bordes del rango y lo de detrás se adelanta
      const hard = { ...t, clips: t.clips.filter((c) => !elastic(c)) };
      clearRange(p, hard, from, to);
      for (const c of hard.clips) if (c.start >= to - 0.0005) c.start = round(c.start - len);
      t.clips = [...soft, ...hard.clips];
      sortClips(t);
    }
  }
  return dropSlivers(p);
}

// Zoom de un clip en el segundo `local` desde su inicio. Con zoomTo el zoom pasa de `zoom` a `zoomTo`
// con una curva suave durante zoomTime segundos (por defecto, todo el clip) y luego se queda fijo.
// Un "punch-in" suave: zoom=1 zoomTo=1.2 zoomTime=0.4. Un acercamiento lento: zoom=1 zoomTo=1.1.
export function zoomAt(c, local) {
  const z0 = c.zoom || 1;
  if (c.zoomTo == null || c.zoomTo === z0) return z0;
  const T = c.zoomTime > 0 ? c.zoomTime : c.duration;
  const x = Math.max(0, Math.min(1, local / T));
  const e = x * x * (3 - 2 * x);
  return z0 + (c.zoomTo - z0) * e;
}

// Corrige y completa un proyecto leído de disco (por si Claude o una persona lo editó a mano).
export function normalize(p0) {
  const p = clone(p0);
  p.version = p.version || VERSION;
  p.name = p.name || 'Proyecto';
  p.width = p.width || 1920;
  p.height = p.height || 1080;
  p.fps = p.fps || 30;
  p.assets = p.assets || {};
  p.tracks = Array.isArray(p.tracks) ? p.tracks : [];
  const ids = new Set();
  for (const t of p.tracks) {
    t.kind = t.kind === 'audio' ? 'audio' : 'video';
    if (!t.id || ids.has(t.id)) t.id = nextId(p, t.kind === 'audio' ? 'a' : 'v');
    ids.add(t.id);
    t.name = t.name || t.id;
    t.clips = Array.isArray(t.clips) ? t.clips : [];
  }
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (!c.id || ids.has(c.id)) c.id = nextId(p, 'c');
      ids.add(c.id);
      c.start = round(Number(c.start) || 0);
      c.in = round(Number(c.in) || 0);
      c.duration = round(Number(c.duration) || DEFAULT_STILL_DURATION);
    }
    sortClips(t);
  }
  return p;
}

// Lista de problemas del proyecto (para avisar a Claude desde la CLI).
export function validate(p) {
  const problems = [];
  for (const t of p.tracks) {
    for (let i = 0; i < t.clips.length; i++) {
      const c = t.clips[i];
      const kind = kindOf(c.src);
      if (!kind) problems.push(`${c.id}: tipo de archivo no soportado (${c.src})`);
      else if (trackKindFor(kind) !== t.kind) problems.push(`${c.id}: un ${kind} no puede ir en la pista de ${t.kind} ${t.id}`);
      if (!p.assets[c.src]) problems.push(`${c.id}: falta información del archivo ${c.src}`);
      else if (p.assets[c.src].missing) problems.push(`${c.id}: no se encuentra el archivo ${c.src}`);
      if (c.zoom != null && !(c.zoom >= 1 && c.zoom <= 5)) problems.push(`${c.id}: zoom debe estar entre 1 y 5`);
      if (c.zoomTo != null && !(c.zoomTo >= 1 && c.zoomTo <= 5)) problems.push(`${c.id}: zoomTo debe estar entre 1 y 5`);
      const sd = sourceDuration(p, c.src);
      if (c.in + c.duration > sd + 0.01) problems.push(`${c.id}: se sale del final del archivo fuente (${sd}s)`);
      const next = t.clips[i + 1];
      if (next && next.start < clipEnd(c) - 0.0005) problems.push(`${c.id} y ${next.id} se solapan en la pista ${t.id}`);
    }
  }
  return problems;
}

export function formatTime(t, fps) {
  const sign = t < 0 ? '-' : '';
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (!fps) return `${base}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`;
  return `${base}:${String(Math.floor((t % 1) * fps + 1e-6)).padStart(2, '0')}`;
}

// Acepta "12.5", "1:02.5", "00:01:02.5".
export function parseTime(str) {
  if (typeof str === 'number') return str;
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some((x) => Number.isNaN(x))) throw new Error(`Tiempo no válido: ${str}`);
  return round(parts.reduce((acc, x) => acc * 60 + x, 0));
}
