// Copias ligeras ("proxies") para que la preview vaya fluida.
// Un vídeo de OBS a 1080p suele tener un fotograma completo cada varios segundos: saltar a un corte
// obliga a decodificar desde muy atrás y la preview se para. La copia ligera es de 540p con un
// fotograma completo cada medio segundo, así que saltar es casi instantáneo. Solo la usa la preview:
// la exportación siempre usa el original.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ffmpegPath, resolveSrc } from './media.mjs';
import { detectEncoder } from './export.mjs';

export const PROXY_DIR = path.join('.editor', 'proxies');
export const PROXY_HEIGHT = 540;

const indexFile = (dir) => path.join(dir, PROXY_DIR, 'index.json');

export function needsProxy(asset) {
  return !!asset && asset.kind === 'video' && !asset.missing && !asset.alpha && (asset.height || 0) > PROXY_HEIGHT;
}

function readIndex(dir) {
  try {
    return JSON.parse(fs.readFileSync(indexFile(dir), 'utf8'));
  } catch {
    return {};
  }
}

// Copias ligeras listas: { src: ruta relativa a la carpeta del proyecto }
export function readProxies(dir, project) {
  const idx = readIndex(dir);
  const out = {};
  for (const [src, e] of Object.entries(idx)) {
    const a = project.assets[src];
    if (a && e.mtime === a.mtime && fs.existsSync(path.join(dir, e.file))) out[src] = e.file.split(path.sep).join('/');
  }
  return out;
}

export function pendingProxies(dir, project) {
  const ready = readProxies(dir, project);
  return Object.entries(project.assets)
    .filter(([src, a]) => needsProxy(a) && !ready[src])
    .map(([src]) => src);
}

function encoderArgs(enc) {
  if (enc === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '28', '-b:v', '0'];
  if (enc === 'h264_qsv') return ['-c:v', 'h264_qsv', '-global_quality', '28'];
  if (enc === 'h264_amf') return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '30'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'];
}

export async function makeProxy(dir, project, src, { onProgress, signal } = {}) {
  const asset = project.assets[src];
  const abs = resolveSrc(dir, src);
  const name = crypto.createHash('sha1').update(abs + asset.mtime).digest('hex').slice(0, 16) + '.mp4';
  const rel = path.join(PROXY_DIR, name);
  const out = path.join(dir, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.part.mp4';
  const enc = await detectEncoder();
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', abs, '-vf', `scale=-2:${PROXY_HEIGHT}`, ...encoderArgs(enc), '-pix_fmt', 'yuv420p', '-g', '15', '-keyint_min', '15',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', tmp];
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    signal?.addEventListener('abort', () => child.kill());
    child.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m && asset.duration) onProgress?.(Math.min(1, Number(m[m.length - 1].split('=')[1]) / 1e6 / asset.duration));
    });
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`No se pudo crear la copia ligera de ${src}: ${err.trim().split('\n').pop()}`))));
  });
  fs.renameSync(tmp, out);
  const idx = readIndex(dir);
  idx[src] = { file: rel, mtime: asset.mtime };
  fs.writeFileSync(indexFile(dir), JSON.stringify(idx, null, 2));
  return rel;
}
