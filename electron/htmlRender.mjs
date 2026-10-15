// Renderiza animaciones HTML fotograma a fotograma en una ventana invisible con fondo transparente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { BrowserWindow } from 'electron';
import { ffmpegPath, CACHE_DIR, resolveSrc } from '../core/media.mjs';

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
    `window.__cupcutSeek && window.__cupcutSeek(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
  );
  let img = await win.webContents.capturePage();
  const s = img.getSize();
  if (s.width !== width || s.height !== height) img = img.resize({ width, height, quality: 'best' });
  return img.toPNG();
}

function cacheKey(dir, project, clip) {
  const file = resolveSrc(dir, clip.src);
  const stat = fs.statSync(file);
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([file, stat.mtimeMs, clip.in, clip.duration, project.width, project.height, project.fps]))
    .digest('hex')
    .slice(0, 16);
}

export function makeHtmlRenderer({ dir, project, urlFor }) {
  const { width, height, fps } = project;
  const cache = path.join(dir, CACHE_DIR);

  async function renderHtml(clip, onFrac) {
    fs.mkdirSync(cache, { recursive: true });
    const out = path.join(cache, `anim-${cacheKey(dir, project, clip)}.mov`);
    if (fs.existsSync(out)) return out;
    const tmp = out + '.part.mov';
    const win = await openPage(urlFor(resolveSrc(dir, clip.src)), width, height);
    const ff = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'png', '-pix_fmt', 'rgba', tmp], { windowsHide: true });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    const done = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('FFmpeg falló al guardar la animación: ' + err))));
    });
    try {
      const frames = Math.max(1, Math.round(clip.duration * fps));
      for (let i = 0; i < frames; i++) {
        const png = await captureAt(win, clip.in + i / fps, width, height);
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
        onFrac?.(i / frames);
      }
      ff.stdin.end();
      await done;
    } finally {
      win.destroy();
    }
    fs.renameSync(tmp, out);
    return out;
  }

  async function renderHtmlFrame(clip, localTime) {
    fs.mkdirSync(cache, { recursive: true });
    const out = path.join(cache, `frame-${crypto.randomBytes(4).toString('hex')}.png`);
    const win = await openPage(urlFor(resolveSrc(dir, clip.src)), width, height);
    try {
      fs.writeFileSync(out, await captureAt(win, localTime, width, height));
    } finally {
      win.destroy();
    }
    return out;
  }

  return { renderHtml, renderHtmlFrame };
}
