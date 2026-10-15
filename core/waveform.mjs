// Forma de onda de los archivos de audio y vídeo (solo Node).
// Se guarda un pico por cada 10 ms (un byte: 0-255, en escala de raíz cuadrada para que la voz baja
// se vea) en .editor/waveforms/. La usan el timeline de la app y el ducking de la música.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ffmpegPath, resolveSrc } from './media.mjs';
import { PEAKS_RATE } from './duck.mjs';

export const WAVEFORM_DIR = path.join('.editor', 'waveforms');

function cacheFile(dir, abs, mtime) {
  return path.join(dir, WAVEFORM_DIR, crypto.createHash('sha1').update(abs + '|' + mtime).digest('hex').slice(0, 16) + '.bin');
}

// Picos ya calculados (o null).
export function readPeaks(dir, p, src) {
  const a = p.assets[src];
  if (!a || a.missing || !(a.kind === 'audio' || (a.kind === 'video' && a.hasAudio))) return null;
  const f = cacheFile(dir, resolveSrc(dir, src), a.mtime);
  return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
}

export async function computePeaks(dir, p, src, { signal } = {}) {
  const cached = readPeaks(dir, p, src);
  if (cached) return cached;
  const a = p.assets[src];
  const abs = resolveSrc(dir, src);
  const rate = 8000;
  const win = rate / PEAKS_RATE;
  const peaks = [];
  let max = 0;
  let count = 0;
  let carry = null;
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { windowsHide: true });
    signal?.addEventListener('abort', () => child.kill());
    child.stdout.on('data', (d) => {
      let buf = carry ? Buffer.concat([carry, d]) : d;
      const even = buf.length & ~1;
      carry = even < buf.length ? buf.subarray(even) : null;
      for (let i = 0; i < even; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > max) max = v;
        if (++count === win) {
          peaks.push(Math.round(Math.sqrt(max / 32768) * 255));
          max = 0;
          count = 0;
        }
      }
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`No se pudo leer el audio de ${src}: ${err.trim().split('\n').pop()}`))));
  });
  if (count) peaks.push(Math.round(Math.sqrt(max / 32768) * 255));
  const out = Uint8Array.from(peaks);
  const f = cacheFile(dir, abs, a.mtime);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out);
  return out;
}
