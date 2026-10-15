// Composición final con FFmpeg. Solo Node.
// Las animaciones HTML no las sabe pintar FFmpeg: quien llama pasa `renderHtml`, que las convierte
// en un vídeo con transparencia (lo hace Electron, ver electron/htmlRender.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, resolveSrc } from './media.mjs';
import { totalDuration, activeClipsAt, kindOf } from './project.mjs';

function n(x) {
  return Number(x.toFixed(6)).toString();
}

function scaleFilter(p, fit) {
  const { width: W, height: H } = p;
  if (fit === 'cover') return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (fit === 'stretch') return `scale=${W}:${H}`;
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease`;
}

// Zoom: se rellena hasta el tamaño del lienzo (transparente), se escala y se recorta alrededor
// del punto de enfoque. Es lo mismo que hace la preview con transform: scale() + transform-origin.
function zoomFilter(p, it) {
  const z = it.zoom || 1;
  if (z === 1) return '';
  const { width: W, height: H } = p;
  const zw = Math.round((W * z) / 2) * 2;
  const zh = Math.round((H * z) / 2) * 2;
  const x = Math.round((zw - W) * (it.zoomX ?? 0.5));
  const y = Math.round((zh - H) * (it.zoomY ?? 0.5));
  return `,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,scale=${zw}:${zh},crop=${W}:${H}:${x}:${y}`;
}

// items: [{ kind, file, start, in, duration, fit, volume, audio: bool, visual: bool, prerendered: bool }]
function buildArgs(p, items, total, { out, frame = false }) {
  const args = ['-y', '-hide_banner'];
  const filters = [];
  const { width: W, height: H, fps } = p;
  filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p[base]`);
  let cur = 'base';
  const audioLabels = [];
  items.forEach((it, k) => {
    if (it.kind === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', n(it.duration), '-i', it.file);
    else if (it.prerendered) args.push('-i', it.file);
    else args.push('-ss', n(it.in), '-t', n(it.duration), '-i', it.file);
    if (it.visual) {
      const v = `v${k}`;
      filters.push(`[${k}:v]fps=${fps},${scaleFilter(p, it.fit)},format=rgba${zoomFilter(p, it)},setpts=PTS-STARTPTS+${n(it.start)}/TB[${v}]`);
      const end = it.start + it.duration;
      filters.push(`[${cur}][${v}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${n(it.start)},${n(end)})'[o${k}]`);
      cur = `o${k}`;
    }
    if (it.audio && !frame) {
      const a = `a${k}`;
      const ms = Math.round(it.start * 1000);
      filters.push(`[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(it.volume ?? 1)},adelay=${ms}:all=1[${a}]`);
      audioLabels.push(a);
    }
  });
  filters.push(`[${cur}]format=yuv420p[vout]`);
  if (frame) {
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-frames:v', '1', out);
    return args;
  }
  if (audioLabels.length > 1) {
    filters.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,apad[aout]`);
  } else if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]apad[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo[aout]`);
  }
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', n(total),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    out,
  );
  return args;
}

function runFfmpeg(args, { total, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    signal?.addEventListener('abort', () => child.kill());
    child.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m && total) {
        const us = Number(m[m.length - 1].split('=')[1]);
        onProgress?.(Math.min(1, us / 1e6 / total));
      }
    });
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal?.aborted) reject(new Error('Exportación cancelada'));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg falló (código ${code}):\n${err}`));
    });
  });
}

function zoomOf(c) {
  return { zoom: c.zoom, zoomX: c.zoomX, zoomY: c.zoomY };
}

function visualTracks(p) {
  return p.tracks.filter((t) => t.kind === 'video' && !t.hidden);
}

// Exporta el proyecto completo a MP4.
// renderHtml(clip) => Promise<ruta a vídeo con alfa de exactamente clip.duration segundos>
export async function exportProject({ dir, project: p, out, renderHtml, onProgress, signal }) {
  const total = totalDuration(p);
  if (total <= 0) throw new Error('El proyecto está vacío');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const htmlClips = visualTracks(p).flatMap((t) => t.clips.filter((c) => kindOf(c.src) === 'html'));
  const rendered = new Map();
  for (let i = 0; i < htmlClips.length; i++) {
    const c = htmlClips[i];
    onProgress?.({ phase: 'animaciones', label: `Animación ${i + 1}/${htmlClips.length}`, value: i / htmlClips.length });
    rendered.set(c.id, await renderHtml(c, (f) => onProgress?.({ phase: 'animaciones', label: `Animación ${i + 1}/${htmlClips.length}`, value: (i + f) / htmlClips.length })));
    if (signal?.aborted) throw new Error('Exportación cancelada');
  }

  const items = [];
  for (const t of p.tracks) {
    if (t.kind === 'video' && t.hidden) continue;
    for (const c of t.clips) {
      const kind = kindOf(c.src);
      const asset = p.assets[c.src] || {};
      const visual = t.kind === 'video';
      const audio = !t.muted && (kind === 'audio' || (kind === 'video' && asset.hasAudio)) && (c.volume ?? 1) > 0;
      if (!visual && !audio) continue;
      if (kind === 'html') {
        items.push({ ...zoomOf(c), kind, file: rendered.get(c.id), prerendered: true, start: c.start, in: 0, duration: c.duration, fit: c.fit, visual, audio: false });
      } else {
        items.push({ ...zoomOf(c), kind, file: resolveSrc(dir, c.src), start: c.start, in: c.in, duration: c.duration, fit: c.fit, volume: c.volume, visual, audio });
      }
    }
  }
  const args = buildArgs(p, items, total, { out });
  onProgress?.({ phase: 'video', label: 'Codificando vídeo', value: 0 });
  await runFfmpeg(args, { total, signal, onProgress: (v) => onProgress?.({ phase: 'video', label: 'Codificando vídeo', value: v }) });
  return out;
}

// Exporta un único fotograma compuesto del instante t a PNG (útil para que Claude "vea" el vídeo).
// renderHtmlFrame(clip, localTime) => Promise<ruta a PNG con alfa>
export async function exportFrame({ dir, project: p, t, out, renderHtmlFrame }) {
  const items = [];
  for (const { track, clip } of activeClipsAt(p, t)) {
    if (track.kind !== 'video' || track.hidden) continue;
    const kind = kindOf(clip.src);
    const local = clip.in + (t - clip.start);
    if (kind === 'html') {
      items.push({ ...zoomOf(clip), kind: 'image', file: await renderHtmlFrame(clip, local), start: 0, duration: 1 / p.fps, visual: true, fit: clip.fit });
    } else if (kind === 'image') {
      items.push({ ...zoomOf(clip), kind, file: resolveSrc(dir, clip.src), start: 0, duration: 1 / p.fps, visual: true, fit: clip.fit });
    } else {
      items.push({ ...zoomOf(clip), kind, file: resolveSrc(dir, clip.src), start: 0, in: local, duration: 1, visual: true, fit: clip.fit });
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await runFfmpeg(buildArgs(p, items, 1, { out, frame: true }), {});
  return out;
}
