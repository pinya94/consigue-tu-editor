// Acceso a disco y a FFmpeg (solo Node: proceso principal y CLI).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROJECT_FILE, kindOf, normalize, createProject, allClips } from './project.mjs';

const require = createRequire(import.meta.url);

function unpacked(p) {
  // dentro de un .asar empaquetado los binarios están en app.asar.unpacked
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

export const ffmpegPath = process.env.EDITOR_FFMPEG || unpacked(require('ffmpeg-static'));
export const ffprobePath = process.env.EDITOR_FFPROBE || unpacked(require('ffprobe-static').path);

export const MEDIA_DIR = 'media';
export const CACHE_DIR = path.join('.editor', 'cache');

export function run(bin, args, { onStderr, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      onStdout?.(String(d));
    });
    child.stderr.on('data', (d) => {
      err += d;
      onStderr?.(String(d));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(bin)} terminó con código ${code}\n${err.slice(-2000)}`));
    });
  });
}

// ---------- Proyecto en disco ----------

export function projectFile(dir) {
  return path.join(dir, PROJECT_FILE);
}

// Busca la carpeta del proyecto subiendo desde `start`.
export function findProjectDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(projectFile(dir))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadProject(dir) {
  const raw = fs.readFileSync(projectFile(dir), 'utf8');
  return normalize(JSON.parse(raw));
}

export function serialize(p) {
  return JSON.stringify(p, null, 2) + '\n';
}

// Escritura atómica: así quien vigile el archivo nunca lo lee a medias.
export function saveProject(dir, p) {
  const text = serialize(p);
  const tmp = projectFile(dir) + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, projectFile(dir));
  return text;
}

export function initProject(dir, opts = {}) {
  fs.mkdirSync(path.join(dir, MEDIA_DIR), { recursive: true });
  fs.mkdirSync(path.join(dir, 'export'), { recursive: true });
  if (fs.existsSync(projectFile(dir))) throw new Error(`Ya existe un proyecto en ${dir}`);
  const p = createProject({ name: opts.name || path.basename(path.resolve(dir)), ...opts });
  saveProject(dir, p);
  writeProjectGuide(dir);
  return p;
}

export const APP_NAME = 'Consigue tu editor de vídeo optimizado para Claude gratis';

const GUIDE_MARK = '<!-- editor:auto -->';

// Comando con el que Claude llama a la CLI: el .exe instalado, o node + el script en desarrollo.
export function cliCommand() {
  const packaged = process.versions.electron && !process.defaultApp;
  if (packaged) return `"${process.execPath.replaceAll('\\', '/')}" --cli`;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return `node "${path.resolve(here, '..', 'cli', 'editor.mjs').replaceAll('\\', '/')}"`;
}

// Copia la guía para Claude dentro de la carpeta del proyecto. Si ya hay un CLAUDE.md escrito por
// otra persona (sin la marca automática) no se toca.
export function writeProjectGuide(dir) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = path.join(here, '..', 'docs', 'CLAUDE-proyecto.md');
  if (!fs.existsSync(template)) return;
  const target = path.join(dir, 'CLAUDE.md');
  // (las versiones antiguas no tenían la marca, pero empezaban con este título)
  const ours = (t) => t.includes(GUIDE_MARK) || t.includes('<!-- cupcut:auto -->') || t.startsWith('# Proyecto de vídeo CupCut');
  if (fs.existsSync(target) && !ours(fs.readFileSync(target, 'utf8'))) return;
  const text = GUIDE_MARK + '\n' + fs.readFileSync(template, 'utf8').replaceAll('{{EDITOR}}', cliCommand()).replaceAll('{{NAME}}', APP_NAME);
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) return;
  fs.writeFileSync(target, text);
}

// Hoja de miniaturas de un clip: cuadrículas con el segundo del timeline marcado en cada fotograma.
// Sirve para que Claude revise un vídeo largo de un vistazo (p. ej. dónde no se mira a cámara).
export async function contactSheet(dir, p, clip, { every = 2, from, to, cols = 6, rows = 5, out }) {
  const start = Math.max(clip.start, from ?? clip.start);
  const end = Math.min(clip.start + clip.duration, to ?? clip.start + clip.duration);
  if (end <= start) throw new Error('El rango está fuera del clip');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  for (const f of fs.readdirSync(path.dirname(out))) {
    if (f.startsWith(path.basename(out) + '-')) fs.rmSync(path.join(path.dirname(out), f));
  }
  const font = 'C:/Windows/Fonts/arial.ttf';
  const fontArg = fs.existsSync(font) ? `fontfile='C\\:/Windows/Fonts/arial.ttf':` : '';
  const label = `drawtext=${fontArg}text='%{eif\\:floor(t+${start})\\:d}.%{eif\\:mod(floor((t+${start})*10)\\,10)\\:d}s':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`;
  const vf = `fps=1/${every},scale=320:-2,${label},tile=${cols}x${rows}:padding=4:margin=4`;
  await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(clip.in + (start - clip.start)), '-t', String(end - start), '-i', resolveSrc(dir, clip.src), '-vf', vf, '-an', `${out}-%02d.png`]);
  const perPage = cols * rows * every;
  const pages = fs.readdirSync(path.dirname(out)).filter((f) => f.startsWith(path.basename(out) + '-')).sort();
  return pages.map((f, i) => ({ file: path.join(path.dirname(out), f), from: start + i * perPage, to: Math.min(end, start + (i + 1) * perPage) }));
}

// Ruta absoluta de un src (relativo a la carpeta del proyecto o absoluto).
export function resolveSrc(dir, src) {
  return path.isAbsolute(src) ? src : path.join(dir, src);
}

// Ruta que se guarda en el proyecto: relativa si el archivo está dentro de la carpeta.
export function toSrc(dir, abs) {
  const rel = path.relative(dir, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  return abs.split(path.sep).join('/');
}

// ---------- WAV ----------

// Muestras de un WAV PCM de 16 bits (mono).
export function readWavSamples(file) {
  const b = fs.readFileSync(file);
  let off = 12;
  let rate = 16000;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
    if (id === 'data') {
      const len = Math.min(size, b.length - off - 8) >> 1;
      const start = b.byteOffset + off + 8;
      return { samples: new Int16Array(b.buffer.slice(start, start + len * 2)), rate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error(`WAV no válido: ${file}`);
}

export function writeWav(file, samples, rate = 16000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(samples.length * 2, 40);
  Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2).copy(b, 44);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}

// ---------- Análisis de archivos ----------

export async function probe(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`Tipo no soportado: ${file}`);
  const stat = fs.statSync(file);
  if (kind === 'html') {
    // Una animación puede declarar su duración: <meta name="animation-duration" content="4.5">
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<meta[^>]+name=["'](?:animation|cupcut)-duration["'][^>]*content=["']([\d.]+)["']/i)
      || html.match(/<meta[^>]+content=["']([\d.]+)["'][^>]*name=["'](?:animation|cupcut)-duration["']/i);
    return { kind, duration: m ? Number(m[1]) : null, mtime: stat.mtimeMs };
  }
  const { out } = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(out);
  const v = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const meta = { kind, mtime: stat.mtimeMs };
  if (kind === 'image') {
    meta.duration = null;
  } else {
    meta.duration = Math.round(Number(info.format.duration || (v && v.duration) || (a && a.duration) || 0) * 1000) / 1000;
  }
  if (v) {
    meta.width = v.width;
    meta.height = v.height;
    // WebM con canal alfa (VP8/VP9) lo marca en las etiquetas
    if (v.tags && (v.tags.alpha_mode === '1' || v.tags.ALPHA_MODE === '1')) meta.alpha = true;
  }
  meta.hasAudio = !!a;
  return meta;
}

// Rellena `assets` con los metadatos que falten o estén desactualizados.
// También registra los archivos nuevos que aparezcan en la carpeta media/.
export async function syncAssets(dir, p0, { scanMedia = true } = {}) {
  const p = JSON.parse(JSON.stringify(p0));
  let changed = false;
  const srcs = new Set([...Object.keys(p.assets), ...allClips(p).map((c) => c.src)]);
  if (scanMedia) {
    const mediaDir = path.join(dir, MEDIA_DIR);
    if (fs.existsSync(mediaDir)) {
      for (const f of fs.readdirSync(mediaDir, { recursive: true })) {
        const abs = path.join(mediaDir, String(f));
        if (kindOf(abs) && fs.statSync(abs).isFile()) srcs.add(toSrc(dir, abs));
      }
    }
  }
  for (const src of srcs) {
    const abs = resolveSrc(dir, src);
    const prev = p.assets[src];
    if (!fs.existsSync(abs)) {
      const inUse = allClips(p).some((c) => c.src === src);
      if (!inUse && prev) {
        delete p.assets[src];
        changed = true;
      } else if (inUse && (!prev || !prev.missing)) {
        p.assets[src] = { ...(prev || { kind: kindOf(src) }), missing: true };
        changed = true;
      }
      continue;
    }
    const mtime = fs.statSync(abs).mtimeMs;
    if (prev && !prev.missing && prev.mtime === mtime) continue;
    try {
      p.assets[src] = await probe(abs);
      changed = true;
    } catch (e) {
      console.error(`No se pudo analizar ${src}: ${e.message}`);
    }
  }
  return { project: p, changed };
}

// Detecta silencios en un archivo. Devuelve rangos en segundos del archivo fuente.
export async function detectSilences(file, { noise = -35, minDuration = 0.5, from = 0, to = null } = {}) {
  const args = ['-hide_banner', '-nostats'];
  if (from > 0) args.push('-ss', String(from));
  if (to != null) args.push('-t', String(to - from));
  args.push('-i', file, '-vn', '-af', `silencedetect=noise=${noise}dB:d=${minDuration}`, '-f', 'null', '-');
  const { err } = await run(ffmpegPath, args);
  const ranges = [];
  let cur = null;
  for (const line of err.split(/\r?\n/)) {
    let m = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (m) cur = { start: Math.max(0, Number(m[1])) + from };
    m = line.match(/silence_end:\s*([\d.]+)/);
    if (m && cur) {
      cur.end = Number(m[1]) + from;
      ranges.push(cur);
      cur = null;
    }
  }
  if (cur) cur.end = to != null ? to : Infinity; // silencio hasta el final
  if (cur) ranges.push(cur);
  return ranges;
}

// Umbral de silencio adaptado al clip: mide el nivel en ventanas de 50 ms, toma el ruido de fondo
// (percentil 10) y el nivel de voz (percentil 90), y pone el umbral cerca de la mitad del camino:
// así las respiraciones y los clics de ratón (unos dB por encima del fondo) cuentan como silencio.
// Se mide sobre el archivo entero (y se recuerda): un clip corto puede ser casi todo silencio y
// entonces no tendría voz con la que comparar.
const thresholdCache = new Map();
export async function autoNoiseThreshold(file) {
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {}
  const key = file + '|' + mtime;
  if (!thresholdCache.has(key)) thresholdCache.set(key, measureThreshold(file));
  return thresholdCache.get(key);
}

async function measureThreshold(file) {
  const args = ['-hide_banner', '-nostats', '-i', file, '-vn',
    '-af', 'aresample=16000,asetnsamples=n=800,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=print:key=lavfi.astats.Overall.RMS_level',
    '-f', 'null', '-'];
  const { err } = await run(ffmpegPath, args);
  const levels = [...err.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -100 : Number(m[1]))).filter(Number.isFinite).sort((a, b) => a - b);
  if (levels.length < 20) return -35;
  const floor = levels[Math.floor(levels.length * 0.1)];
  const speech = levels[Math.floor(levels.length * 0.9)];
  const threshold = floor + Math.max(8, (speech - floor) * 0.45);
  return Math.round(Math.max(-60, Math.min(-20, threshold)));
}

// Silencios de un clip que conviene quitar, ya en tiempo del timeline.
// Reglas para que los cortes no queden bruscos:
//  - margen asimétrico: poco antes de empezar a hablar (padBefore) y más después de hablar (padAfter),
//    para no comerse finales de palabra ni respiraciones;
//  - solo silencios de al menos minDuration (las pausas naturales se quedan);
//  - un ruido suelto de menos de maxBlip (un clic, una respiración) no parte un silencio en dos;
//  - ningún trozo hablado puede quedar más corto que minClip: si pasaría, ese silencio no se quita.
export async function clipSilences(dir, p, clip, opts = {}) {
  const { minDuration = 0.6, minClip = 0.8, maxBlip = 0.3 } = opts;
  const padBefore = opts.padBefore ?? opts.pad ?? 0.1;
  const padAfter = opts.padAfter ?? opts.pad ?? 0.22;
  const asset = p.assets[clip.src];
  if (!asset || !asset.hasAudio) throw new Error(`El clip ${clip.id} no tiene audio`);
  const file = resolveSrc(dir, clip.src);
  const from = clip.in;
  const to = clip.in + clip.duration;
  const noise = opts.noise == null || opts.noise === 'auto' ? await autoNoiseThreshold(file) : Number(opts.noise);
  const raw = joinAcrossBlips(await detectSilences(file, { noise, minDuration: 0.15, from, to }), maxBlip).filter((r) => r.end - r.start >= minDuration);
  // rangos a quitar, en tiempo del archivo fuente
  let ranges = [];
  for (const r of raw) {
    const s = Math.max(from, r.start) + (r.start <= from ? 0 : padAfter);
    const e = Math.min(to, r.end) - (r.end >= to ? 0 : padBefore);
    if (e - s >= 0.1) ranges.push({ start: s, end: e });
  }
  ranges = mergeShortPieces(ranges, from, to, minClip);
  return {
    noise,
    ranges: ranges.map((r) => ({ start: round3(clip.start + (r.start - from)), end: round3(clip.start + (r.end - from)) })),
  };
}

// Une silencios separados por un ruido muy corto (más corto que maxBlip).
export function joinAcrossBlips(ranges, maxBlip) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start - last.end < maxBlip) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

// Si entre dos silencios queda un trozo hablado más corto que minClip, uno de esos silencios se
// deja sin quitar (el más corto), para que el trozo se una a su vecino en vez de quedar suelto.
export function mergeShortPieces(ranges, from, to, minClip) {
  const r = [...ranges].sort((a, b) => a.start - b.start);
  for (let changed = true; changed && r.length; ) {
    changed = false;
    for (let i = 0; i <= r.length; i++) {
      const pieceStart = i === 0 ? from : r[i - 1].end;
      const pieceEnd = i === r.length ? to : r[i].start;
      const len = pieceEnd - pieceStart;
      if (len <= 0 || len >= minClip) continue;
      // vecinos: el silencio anterior (i-1) y el siguiente (i)
      const before = i > 0 ? i - 1 : null;
      const after = i < r.length ? i : null;
      let victim = after ?? before;
      if (before != null && after != null) victim = r[before].end - r[before].start <= r[after].end - r[after].start ? before : after;
      r.splice(victim, 1);
      changed = true;
      break;
    }
  }
  return r;
}

function round3(t) {
  return Math.round(t * 1000) / 1000;
}
