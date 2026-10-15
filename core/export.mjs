// Composición final con FFmpeg. Solo Node.
//
// Para que funcione con proyectos de cientos de clips, la exportación va por tramos:
//   1. El audio de cada archivo fuente se extrae una vez a WAV (buscar dentro de un WAV es exacto e instantáneo).
//   2. El timeline se parte en tramos de unos segundos. Cada tramo se exporta con un FFmpeg pequeño:
//      vídeo a MP4 y audio a WAV, con fundidos cortos en cada corte. El grafo de filtros va en un archivo,
//      así nunca se supera el límite de longitud de la línea de comandos de Windows.
//   3. Se unen los tramos sin recodificar el vídeo, se normaliza el volumen y se escribe el MP4 final.
// Las animaciones HTML no las sabe pintar FFmpeg: quien llama pasa `renderHtml` (ver electron/htmlRender.mjs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ffmpegPath, resolveSrc, run, writeWav } from './media.mjs';
import { totalDuration, activeClipsAt, kindOf, zoomAt } from './project.mjs';
import { hasDucking, duckLevel, voiceActivity, duckEnvelope, PEAKS_RATE } from './duck.mjs';
import { computePeaks } from './waveform.mjs';

export const PRESETS = {
  final: { label: 'Final', height: null, fast: false, loudnorm: true },
  draft: { label: 'Borrador', height: 480, fast: true, loudnorm: false },
  review: { label: 'Revisión', height: 360, fast: true, loudnorm: false },
};

const CHUNK_SECONDS = 20;
const MAX_ITEMS_PER_CHUNK = 24;
const PARALLEL_CHUNKS = 2;
const FADE = 0.015; // fundido de audio en cada corte, en segundos

function n(x) {
  return Number(x.toFixed(6)).toString();
}

// ---------- codificador ----------

let encoderCache = null;

// Usa la tarjeta gráfica si hay una compatible (NVIDIA, Intel o AMD); si no, la CPU.
export async function detectEncoder() {
  if (encoderCache) return encoderCache;
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
    try {
      await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.2', '-c:v', enc, '-f', 'null', '-']);
      encoderCache = enc;
      return enc;
    } catch {}
  }
  encoderCache = 'libx264';
  return encoderCache;
}

export function videoCodecArgs(enc, fast) {
  if (enc === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', fast ? 'p1' : 'p5', '-rc', 'vbr', '-cq', fast ? '30' : '20', '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (enc === 'h264_qsv') return ['-c:v', 'h264_qsv', '-global_quality', fast ? '30' : '21', '-pix_fmt', 'nv12'];
  if (enc === 'h264_amf') return ['-c:v', 'h264_amf', '-quality', fast ? 'speed' : 'balanced', '-rc', 'cqp', '-qp_i', fast ? '30' : '21', '-qp_p', fast ? '32' : '23', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libx264', '-preset', fast ? 'ultrafast' : 'fast', '-crf', fast ? '30' : '20', '-pix_fmt', 'yuv420p'];
}

// ---------- filtros de imagen ----------

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

// Zoom animado (zoomTo): zoompan con la misma curva suave que zoomAt(). `offset` = segundos del clip
// que ya han pasado al empezar este tramo.
function zoomAnimFilter(p, it, offset) {
  const { width: W, height: H, fps } = p;
  const z0 = it.zoom || 1;
  const z1 = it.zoomTo;
  const T = it.zoomTime > 0 ? it.zoomTime : it.clipDuration;
  const x = `st(0,clip((on/${fps}+${n(offset)})/${n(T)},0,1))`;
  const z = `${x}*0+${n(z0)}+(${n(z1 - z0)})*ld(0)*ld(0)*(3-2*ld(0))`;
  const fx = n(it.zoomX ?? 0.5);
  const fy = n(it.zoomY ?? 0.5);
  return `,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,zoompan=z='${z}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':d=1:s=${W}x${H}:fps=${fps}`;
}

function isAnimated(it) {
  return it.zoomTo != null && it.zoomTo !== (it.zoom || 1);
}

// Entrada de FFmpeg para un elemento visual, recortada a [from, from+dur) de su archivo.
// Para vídeo se empieza a leer un poco antes (preroll) y se recorta con trim: así el primer
// fotograma está justo en el punto de corte y no queda un fotograma negro al empezar el clip.
function visualInput(p, it, from, dur) {
  if (it.kind === 'image') return { args: ['-loop', '1', '-framerate', String(p.fps), '-t', n(dur), '-i', it.file], trim: '' };
  const dec = it.alphaWebm ? ['-c:v', 'libvpx-vp9'] : []; // el decodificador nativo de VP9 ignora el canal alfa
  const preroll = Math.min(0.5, from);
  return {
    args: [...dec, '-ss', n(from - preroll), '-t', n(dur + preroll), '-i', it.file],
    trim: preroll > 0 ? `trim=start=${n(preroll)},setpts=PTS-STARTPTS,` : '',
  };
}

// ---------- un tramo ----------

// Exporta el tramo [a, b) del timeline: vídeo (sin audio) a videoOut y audio PCM a audioOut.
async function exportChunk({ p, items, a, b, enc, fast, videoOut, audioOut, scriptFile, signal, log, gainFile }) {
  const dur = b - a;
  const { width: W, height: H, fps } = p;
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [`color=c=black:s=${W}x${H}:r=${fps}:d=${n(dur)},format=yuv420p[base]`];
  let cur = 'base';
  const audioLabels = [];
  const duckLabels = [];
  let idx = 0;
  for (const it of items) {
    const s = Math.max(it.start, a);
    const e = Math.min(it.start + it.duration, b);
    if (e - s <= 1e-6) continue;
    const from = it.in + (s - it.start);
    const len = e - s;
    const local = s - a;
    if (it.visual) {
      const vin = visualInput(p, it, from, len);
      args.push(...vin.args);
      const k = idx++;
      const zoom = isAnimated(it) ? zoomAnimFilter(p, it, s - it.start) : zoomFilter(p, it);
      filters.push(`[${k}:v]${vin.trim}fps=${fps},${scaleFilter(p, it.fit)},format=rgba${zoom},setpts=PTS-STARTPTS+${n(local)}/TB[v${k}]`);
      filters.push(`[${cur}][v${k}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${n(local)},${n(local + len)})'[o${k}]`);
      cur = `o${k}`;
    }
    if (it.audio) {
      args.push('-ss', n(from), '-t', n(len), '-i', it.audioFile);
      const k = idx++;
      // fundido solo en los bordes reales del clip, no donde lo parte el tramo
      const f = Math.min(FADE, len / 4);
      const fades = [];
      if (s === it.start) fades.push(`afade=t=in:st=0:d=${n(f)}`);
      if (e === it.start + it.duration) fades.push(`afade=t=out:st=${n(len - f)}:d=${n(f)}`);
      const ms = Math.round(local * 1000);
      filters.push(`[${k}:a]volume=${n(it.volume ?? 1)}${fades.map((x) => ',' + x).join('')},adelay=${ms}:all=1[a${k}]`);
      (it.duck != null ? duckLabels : audioLabels).push(`a${k}`);
    }
  }
  filters.push(`[${cur}]format=yuv420p[vout]`);
  const samples = Math.round(dur * 48000);
  // música con ducking: se mezcla aparte y se multiplica por la curva de volumen de este tramo
  if (duckLabels.length) {
    args.push('-ss', n(a), '-t', n(dur), '-i', gainFile);
    const g = idx++;
    const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    const mix = duckLabels.length > 1 ? `${duckLabels.map((l) => `[${l}]`).join('')}amix=inputs=${duckLabels.length}:normalize=0:dropout_transition=0,` : `[${duckLabels[0]}]`;
    filters.push(`${mix}${fmt},apad,atrim=end_sample=${samples}[mus]`);
    filters.push(`[${g}:a]aresample=48000,${fmt},apad,atrim=end_sample=${samples}[gain]`);
    filters.push(`[mus][gain]amultiply[ducked]`);
    audioLabels.push('ducked');
  }
  if (audioLabels.length > 1) filters.push(`${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${samples}[aout]`);
  else if (audioLabels.length === 1) filters.push(`[${audioLabels[0]}]apad,atrim=end_sample=${samples}[aout]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${samples}[aout]`);
  fs.writeFileSync(scriptFile, filters.join(';\n'));
  const frames = Math.round(dur * fps);
  args.push(
    '-filter_complex_script', scriptFile,
    '-map', '[vout]', '-an', '-frames:v', String(frames), '-r', String(fps), ...videoCodecArgs(enc, fast), '-g', String(fps * 2), videoOut,
    '-map', '[aout]', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', audioOut,
  );
  await ffmpegLogged(args, { signal, log });
}

// Elige los cortes del timeline: tramos de ~20 s alineados a fotogramas, más cortos si hay muchos clips.
function planChunks(items, total, fps) {
  const frame = 1 / fps;
  const align = (t) => Math.round(t * fps) * frame;
  const chunks = [];
  let a = 0;
  while (a < total - 1e-6) {
    let b = Math.min(total, align(a + CHUNK_SECONDS));
    for (;;) {
      const count = items.filter((it) => it.start < b && it.start + it.duration > a).length;
      if (count <= MAX_ITEMS_PER_CHUNK || b - a <= frame * 2) break;
      b = Math.max(a + frame, align(a + (b - a) / 2));
    }
    if (b <= a) b = Math.min(total, a + frame);
    chunks.push([a, b]);
    a = b;
  }
  return chunks;
}

// ---------- FFmpeg con registro ----------

function ffmpegLogged(args, { signal, log, total, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    log?.(`$ ffmpeg ${args.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m && total) onProgress?.(Math.min(1, Number(m[m.length - 1].split('=')[1]) / 1e6 / total));
    });
    child.stderr.on('data', (d) => (err = (err + d).slice(-8000)));
    child.on('error', (e) => {
      log?.(`Error al lanzar FFmpeg: ${e.message}`);
      reject(e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) log?.(err.trim());
      if (signal?.aborted) reject(new Error('Exportación cancelada'));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg falló (código ${code}): ${lastLine(err)}`));
    });
  });
}

function lastLine(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-2).join(' · ') || 'sin detalles';
}

async function pool(tasks, size) {
  let next = 0;
  let failed = null;
  async function worker() {
    while (next < tasks.length && !failed) {
      const i = next++;
      try {
        await tasks[i]();
      } catch (e) {
        failed = failed || e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  if (failed) throw failed;
}

// ---------- exportación completa ----------

function zoomOf(c) {
  return { zoom: c.zoom, zoomX: c.zoomX, zoomY: c.zoomY, zoomTo: c.zoomTo, zoomTime: c.zoomTime, clipDuration: c.duration };
}

// Curva de volumen de la música (ducking) para todo el timeline, en un WAV de 1000 Hz.
async function writeGainFile(dir, p, file, log) {
  const peaks = {};
  for (const t of p.tracks) {
    if (duckLevel(t) != null) continue;
    for (const c of t.clips) if (!peaks[c.src] && (kindOf(c.src) === 'video' || kindOf(c.src) === 'audio') && p.assets[c.src]?.hasAudio !== false) peaks[c.src] = await computePeaks(dir, p, c.src).catch(() => null);
  }
  const act = voiceActivity(p, peaks);
  const level = Math.min(...p.tracks.map(duckLevel).filter((x) => x != null));
  const env = duckEnvelope(act, { level });
  const rate = 1000;
  const k = rate / PEAKS_RATE;
  const pcm = new Int16Array(env.length * k);
  for (let i = 0; i < pcm.length; i++) {
    const f = i / k;
    const i0 = Math.floor(f);
    const v = env[i0] + ((env[Math.min(env.length - 1, i0 + 1)] ?? env[i0]) - env[i0]) * (f - i0);
    pcm[i] = Math.round(Math.max(0, Math.min(1, v)) * 32767);
  }
  writeWav(file, pcm, rate);
  log?.(`Ducking: música al ${Math.round(level * 100)} % cuando se habla (${Math.round((act.reduce((s, x) => s + x, 0) / Math.max(1, act.length)) * 100)} % del vídeo con voz)`);
  return file;
}

function scaledProject(p, height) {
  if (!height || height >= p.height) return p;
  const width = Math.round((p.width * height) / p.height / 2) * 2;
  return { ...p, width, height };
}

// Exporta el proyecto a MP4.
// renderHtml(clip, onFraction) => Promise<{ file, alpha }>: la animación ya convertida en vídeo.
// options.preset: 'final' | 'draft' | 'review'. options.audioOut: además, guarda el audio en WAV mono de 16 kHz.
export async function exportProject({ dir, project: p0, out, renderHtml, onProgress, signal, preset = 'final', encoder, audioOut, logFile }) {
  const conf = PRESETS[preset] || PRESETS.final;
  const total = totalDuration(p0);
  if (total <= 0) throw new Error('El proyecto está vacío');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = path.join(dir, '.editor', 'export-tmp', crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(tmp, { recursive: true });
  const logLines = [`Exportación ${conf.label} · ${new Date().toISOString()} · ${out}`];
  const log = (s) => logLines.push(s);
  const flushLog = () => {
    if (!logFile) return;
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, logLines.join('\n') + '\n');
    } catch {}
  };
  const report = (phase, label, value) => onProgress?.({ phase, label, value });

  try {
    const enc = encoder || (await detectEncoder());
    log(`Codificador: ${enc}`);
    const p = scaledProject(p0, conf.height);

    // 1. animaciones HTML (en paralelo; cada una devuelve su vídeo)
    const htmlClips = p0.tracks.filter((t) => t.kind === 'video' && !t.hidden).flatMap((t) => t.clips.filter((c) => kindOf(c.src) === 'html'));
    const rendered = new Map();
    const fractions = new Array(htmlClips.length).fill(0);
    const animProgress = () => report('animaciones', `Animaciones (${htmlClips.length})`, fractions.reduce((s, x) => s + x, 0) / Math.max(1, htmlClips.length));
    await pool(
      htmlClips.map((c, i) => async () => {
        rendered.set(c.id, await renderHtml(c, (f) => ((fractions[i] = f), animProgress())));
        fractions[i] = 1;
        animProgress();
      }),
      3,
    );
    if (signal?.aborted) throw new Error('Exportación cancelada');

    // 2. audio de cada fuente a WAV, una sola vez
    const audioSources = new Map();
    const items = [];
    for (const t of p0.tracks) {
      if (t.kind === 'video' && t.hidden) continue;
      for (const c of t.clips) {
        const kind = kindOf(c.src);
        const asset = p0.assets[c.src] || {};
        const visual = t.kind === 'video';
        const audio = !t.muted && (kind === 'audio' || (kind === 'video' && asset.hasAudio)) && (c.volume ?? 1) > 0;
        if (!visual && !audio) continue;
        if (asset.missing) throw new Error(`No se encuentra el archivo de ${c.id}: ${c.src}`);
        if (kind === 'html') {
          const r = rendered.get(c.id);
          items.push({ ...zoomOf(c), kind: 'video', file: r.file, alphaWebm: r.alpha, start: c.start, in: 0, duration: c.duration, fit: c.fit, visual, audio: false });
          continue;
        }
        const file = resolveSrc(dir, c.src);
        if (audio && !audioSources.has(file)) audioSources.set(file, path.join(tmp, `src${audioSources.size}.wav`));
        items.push({ ...zoomOf(c), kind, file, audioFile: audioSources.get(file), start: c.start, in: c.in, duration: c.duration, fit: c.fit, volume: c.volume, visual, audio, duck: t.kind === 'audio' ? duckLevel(t) ?? undefined : undefined });
      }
    }
    let done = 0;
    for (const [file, wav] of audioSources) {
      report('audio', 'Preparando audio', done++ / audioSources.size);
      await ffmpegLogged(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav], { signal, log });
    }

    const gainFile = hasDucking(p0) ? await writeGainFile(dir, p0, path.join(tmp, 'gain.wav'), log) : null;

    // 3. tramos
    const chunks = planChunks(items, total, p.fps);
    log(`${items.length} elementos en ${chunks.length} tramos`);
    let finished = 0;
    const chunkFiles = chunks.map((_, i) => ({ v: path.join(tmp, `c${String(i).padStart(4, '0')}.mp4`), a: path.join(tmp, `c${String(i).padStart(4, '0')}.wav`) }));
    report('video', 'Componiendo vídeo', 0);
    await pool(
      chunks.map(([a, b], i) => async () => {
        if (signal?.aborted) throw new Error('Exportación cancelada');
        const inChunk = items.filter((it) => it.start < b && it.start + it.duration > a);
        await exportChunk({ p, items: inChunk, a, b, enc, fast: conf.fast, videoOut: chunkFiles[i].v, audioOut: chunkFiles[i].a, scriptFile: path.join(tmp, `c${i}.txt`), signal, log, gainFile });
        report('video', `Componiendo vídeo (${++finished}/${chunks.length})`, finished / chunks.length);
      }),
      PARALLEL_CHUNKS,
    );

    // 4. unir, normalizar volumen y escribir el MP4
    const vList = path.join(tmp, 'videos.txt');
    const aList = path.join(tmp, 'audios.txt');
    const q = (f) => `file '${f.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(vList, chunkFiles.map((c) => q(c.v)).join('\n'));
    fs.writeFileSync(aList, chunkFiles.map((c) => q(c.a)).join('\n'));
    const audioFilter = conf.loudnorm ? ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11'] : [];
    report('final', 'Uniendo y normalizando el audio', 0);
    await ffmpegLogged(
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', vList, '-f', 'concat', '-safe', '0', '-i', aList,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioFilter, '-ar', '48000', '-c:a', 'aac', '-b:a', conf.fast ? '128k' : '192k',
        '-t', n(total), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out],
      { signal, log, total, onProgress: (v) => report('final', 'Uniendo y normalizando el audio', v) },
    );
    if (audioOut) {
      // audio ligero para transcribir o escuchar (WAV mono de 16 kHz)
      await ffmpegLogged(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', aList, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioOut], { signal, log });
    }
    log('Terminado.');
    return out;
  } catch (e) {
    log(`ERROR: ${e.message}`);
    throw e;
  } finally {
    flushLog();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- un fotograma ----------

// Exporta un único fotograma compuesto del instante t a PNG (útil para que Claude "vea" el vídeo).
// renderHtmlFrame(clip, localTime) => Promise<ruta a PNG con alfa>
export async function exportFrame({ dir, project: p, t, out, renderHtmlFrame }) {
  const { width: W, height: H, fps } = p;
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [`color=c=black:s=${W}x${H}:r=${fps}:d=1,format=yuv420p[base]`];
  let cur = 'base';
  let k = 0;
  for (const { track, clip } of activeClipsAt(p, t)) {
    if (track.kind !== 'video' || track.hidden) continue;
    const kind = kindOf(clip.src);
    const local = clip.in + (t - clip.start);
    if (kind === 'html') args.push('-i', await renderHtmlFrame(clip, local));
    else if (kind === 'image') args.push('-i', resolveSrc(dir, clip.src));
    else args.push('-ss', n(local), '-i', resolveSrc(dir, clip.src));
    filters.push(`[${k}:v]${scaleFilter(p, clip.fit)},format=rgba${zoomFilter(p, { ...zoomOf(clip), zoom: zoomAt(clip, t - clip.start) })}[v${k}]`);
    filters.push(`[${cur}][v${k}]overlay=x=(W-w)/2:y=(H-h)/2[o${k}]`);
    cur = `o${k++}`;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  args.push('-filter_complex', filters.join(';'), '-map', `[${cur}]`, '-frames:v', '1', out);
  await ffmpegLogged(args);
  return out;
}
