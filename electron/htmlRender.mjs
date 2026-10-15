// Renderiza animaciones HTML fotograma a fotograma en una ventana invisible con fondo transparente.
// - Las animaciones opacas (a pantalla completa) se guardan como H.264: pequeñas y rápidas.
// - Las que tienen transparencia se guardan como VP9 con canal alfa.
// Los fotogramas se pasan a FFmpeg en bruto (BGRA): mucho más rápido que comprimir cada uno a PNG.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { BrowserWindow } from 'electron';
import { ffmpegPath, CACHE_DIR, resolveSrc } from '../core/media.mjs';
import { detectEncoder, videoCodecArgs } from '../core/export.mjs';

const CACHE_VERSION = 'v2';

async function openPage(url, width, height) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadURL(url);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  return win;
}

async function captureAt(win, t, width, height) {
  await win.webContents.executeJavaScript(
    `window.__seekAnimation && window.__seekAnimation(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
  );
  let img = await win.webContents.capturePage();
  const s = img.getSize();
  if (s.width !== width || s.height !== height) img = img.resize({ width, height, quality: 'best' });
  return img;
}

// ¿Todos los píxeles muestreados son opacos? (BGRA: el alfa es cada 4.º byte)
function isOpaque(img) {
  const buf = img.toBitmap();
  for (let i = 3; i < buf.length; i += 4 * 97) if (buf[i] < 250) return false;
  return true;
}

function cacheKey(dir, project, clip) {
  const file = resolveSrc(dir, clip.src);
  const stat = fs.statSync(file);
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([CACHE_VERSION, file, stat.mtimeMs, clip.in, clip.duration, project.width, project.height, project.fps]))
    .digest('hex')
    .slice(0, 16);
}

export function makeHtmlRenderer({ dir, project, urlFor }) {
  const { width, height, fps } = project;
  const cache = path.join(dir, CACHE_DIR);
  const used = new Set();

  async function renderHtml(clip, onFrac) {
    fs.mkdirSync(cache, { recursive: true });
    const key = cacheKey(dir, project, clip);
    for (const [ext, alpha] of [['.mp4', false], ['.webm', true]]) {
      const f = path.join(cache, `anim-${key}${ext}`);
      if (fs.existsSync(f)) {
        used.add(path.basename(f));
        return { file: f, alpha };
      }
    }
    const win = await openPage(urlFor(resolveSrc(dir, clip.src)), width, height);
    try {
      const frames = Math.max(1, Math.round(clip.duration * fps));
      // se miran el principio, la mitad y el final para saber si la animación tapa todo el lienzo
      const samples = [0, Math.floor(frames / 2), frames - 1];
      let opaque = true;
      for (const i of samples) if (!isOpaque(await captureAt(win, clip.in + i / fps, width, height))) opaque = false;
      const out = path.join(cache, `anim-${key}${opaque ? '.mp4' : '.webm'}`);
      const tmp = out + '.part' + path.extname(out);
      const enc = opaque ? videoCodecArgs(await detectEncoder(), false) : ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '30', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1'];
      const ff = spawn(
        ffmpegPath,
        ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', '-', ...enc, '-an', tmp],
        { windowsHide: true },
      );
      let err = '';
      ff.stderr.on('data', (d) => (err += d));
      const done = new Promise((resolve, reject) => {
        ff.on('error', reject);
        ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('FFmpeg falló al guardar la animación: ' + err.slice(-500)))));
      });
      ff.stdin.on('error', () => {}); // si FFmpeg muere, el error llega por `done`
      for (let i = 0; i < frames; i++) {
        const img = await captureAt(win, clip.in + i / fps, width, height);
        if (!ff.stdin.write(img.toBitmap())) await new Promise((r) => ff.stdin.once('drain', r));
        onFrac?.(i / frames);
      }
      ff.stdin.end();
      await done;
      fs.renameSync(tmp, out);
      used.add(path.basename(out));
      return { file: out, alpha: !opaque };
    } finally {
      win.destroy();
    }
  }

  async function renderHtmlFrame(clip, localTime) {
    fs.mkdirSync(cache, { recursive: true });
    const out = path.join(cache, `frame-${crypto.randomBytes(4).toString('hex')}.png`);
    const win = await openPage(urlFor(resolveSrc(dir, clip.src)), width, height);
    try {
      fs.writeFileSync(out, (await captureAt(win, localTime, width, height)).toPNG());
    } finally {
      win.destroy();
    }
    return out;
  }

  // Borra de la caché lo que esta exportación no ha usado (animaciones viejas, fotogramas sueltos).
  function cleanCache() {
    if (!fs.existsSync(cache)) return;
    for (const f of fs.readdirSync(cache)) {
      if (!used.has(f)) fs.rmSync(path.join(cache, f), { force: true, recursive: true });
    }
  }

  return { renderHtml, renderHtmlFrame, cleanCache };
}
