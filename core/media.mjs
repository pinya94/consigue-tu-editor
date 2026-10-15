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

// Silencios de un clip, ya convertidos a tiempo del timeline y con margen (pad) para no cortar sílabas.
export async function clipSilences(dir, p, clip, { noise = -35, minDuration = 0.5, pad = 0.12 } = {}) {
  const asset = p.assets[clip.src];
  if (!asset || !asset.hasAudio) throw new Error(`El clip ${clip.id} no tiene audio`);
  const src = await detectSilences(resolveSrc(dir, clip.src), { noise, minDuration, from: clip.in, to: clip.in + clip.duration });
  const out = [];
  for (const r of src) {
    const s = Math.max(clip.in, r.start) + (r.start <= clip.in ? 0 : pad);
    const e = Math.min(clip.in + clip.duration, r.end) - (r.end >= clip.in + clip.duration ? 0 : pad);
    if (e - s < 0.1) continue;
    out.push({ start: round3(clip.start + (s - clip.in)), end: round3(clip.start + (e - clip.in)) });
  }
  return out;
}

function round3(t) {
  return Math.round(t * 1000) / 1000;
}
