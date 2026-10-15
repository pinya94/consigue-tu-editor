// Transcripción con whisper.cpp (solo Node: CLI y proceso principal).
//
// whisper.cpp y su modelo no van dentro del editor (pesan cientos de MB): se instalan aparte con
// `whisper install` o se indican con `whisper set`. La ubicación se guarda en
// %APPDATA%/consigue-tu-editor/whisper.json (o en las variables EDITOR_WHISPER_BIN y EDITOR_WHISPER_MODEL).
//
// Cada archivo fuente se transcribe una sola vez y se guarda en .editor/transcripts/. La transcripción
// del montaje (.editor/transcript.json) se recalcula a partir de esa caché cada vez que cambian los clips.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ffmpegPath, resolveSrc, run, readWavSamples, writeWav } from './media.mjs';
import { kindOf, totalDuration } from './project.mjs';
import { wordsFromWhisper, speechMask, refineWords, dropHallucinations, transcriptDoc, voiceClips, FRAME_RATE } from './transcript.mjs';

export { readWavSamples, writeWav };

export const TRANSCRIPTS_DIR = path.join('.editor', 'transcripts');
export const AUDIO16_DIR = path.join('.editor', 'audio16k');
export const TRANSCRIPT_FILE = path.join('.editor', 'transcript.json');

// ---------- dónde está whisper ----------

export function whisperConfigFile() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'consigue-tu-editor', 'whisper.json');
}

export function readWhisperConfig() {
  try {
    return JSON.parse(fs.readFileSync(whisperConfigFile(), 'utf8'));
  } catch {
    return {};
  }
}

export function saveWhisperConfig(cfg) {
  const f = whisperConfigFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
}

// { bin, model } listos para usar, o un error que explica qué falta.
export function findWhisper() {
  const cfg = readWhisperConfig();
  const bin = process.env.EDITOR_WHISPER_BIN || cfg.bin;
  const model = process.env.EDITOR_WHISPER_MODEL || cfg.model;
  if (!bin || !fs.existsSync(bin)) throw new Error('No está instalado whisper.cpp. Usa el comando "whisper install --dir <carpeta>" (pregunta antes al usuario: descarga varios cientos de MB) o "whisper set --bin <whisper-cli.exe> --model <ggml-*.bin>".');
  if (!model || !fs.existsSync(model)) throw new Error('Falta el modelo de whisper. Usa "whisper install --dir <carpeta>" o "whisper set --model <ggml-*.bin>".');
  return { bin, model, gpu: cfg.gpu };
}

// Preset de alineación por palabra (DTW) según el nombre del modelo.
export function dtwPreset(model) {
  const n = path.basename(model).toLowerCase();
  const en = /\.en[._-]/.test(n) || n.endsWith('.en.bin');
  if (n.includes('large-v3-turbo')) return 'large.v3.turbo';
  if (n.includes('large-v3')) return 'large.v3';
  if (n.includes('large-v2')) return 'large.v2';
  if (n.includes('large')) return 'large.v1';
  for (const s of ['tiny', 'base', 'small', 'medium']) if (n.includes(s)) return s + (en ? '.en' : '');
  return null;
}

// ---------- instalar ----------

export const WHISPER_RELEASE = 'b5454'; // versión de whisper.cpp probada
export const MODELS = {
  medium: { file: 'ggml-medium-q5_0.bin', mb: 514 },
  small: { file: 'ggml-small-q5_1.bin', mb: 181 },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo-q5_0.bin', mb: 547 },
};
export const BUILDS = {
  cpu: { file: 'whisper-bin-x64.zip', mb: 9 },
  cuda: { file: 'whisper-bin-win-cuda-12.4.0-x64.zip', mb: 685 }, // trae cublas; el de CUDA 11.8 no
};

export async function download(url, out, onLog) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = out + '.part';
  const file = fs.createWriteStream(tmp);
  let got = 0;
  let shown = -1;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
    const pc = total ? Math.floor((got / total) * 10) * 10 : -1;
    if (pc !== shown && pc >= 0) onLog?.(`  ${path.basename(out)}: ${(shown = pc)} %`);
  }
  await new Promise((r, j) => file.end((e) => (e ? j(e) : r())));
  fs.renameSync(tmp, out);
}

// Descarga whisper.cpp y el modelo en `dir` (fuera del disco del sistema si va justo de espacio).
export async function installWhisper({ dir, model = 'medium', gpu = true, onLog = console.log }) {
  const m = MODELS[model];
  if (!m) throw new Error(`Modelo desconocido: ${model} (usa ${Object.keys(MODELS).join(', ')})`);
  const build = BUILDS[gpu ? 'cuda' : 'cpu'];
  dir = path.resolve(dir);
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  const binDir = path.join(dir, gpu ? 'bin-cuda' : 'bin-cpu');
  let bin = path.join(binDir, 'Release', 'whisper-cli.exe');
  if (!fs.existsSync(bin)) {
    const zip = path.join(dir, build.file);
    onLog(`Descargando whisper.cpp (${build.mb} MB)…`);
    await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/${build.file}`, zip, onLog);
    fs.mkdirSync(binDir, { recursive: true });
    await run('tar', ['-xf', zip, '-C', binDir]); // tar de Windows 10+ abre .zip
    fs.rmSync(zip);
    if (!fs.existsSync(bin)) bin = findFile(binDir, 'whisper-cli.exe') || bin;
  }
  const modelFile = path.join(dir, 'models', m.file);
  if (!fs.existsSync(modelFile)) {
    onLog(`Descargando el modelo ${model} (${m.mb} MB)…`);
    await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`, modelFile, onLog);
  }
  saveWhisperConfig({ ...readWhisperConfig(), bin, model: modelFile, gpu });
  return { bin, model: modelFile };
}

function findFile(dir, name) {
  for (const f of fs.readdirSync(dir, { recursive: true })) if (path.basename(String(f)).toLowerCase() === name) return path.join(dir, String(f));
  return null;
}

// ---------- audio ----------

function hashOf(...parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

// WAV mono de 16 kHz de un archivo fuente (lo que necesita whisper). Se guarda para reutilizarlo.
export async function sourceWav16(dir, p, src) {
  const abs = resolveSrc(dir, src);
  const mtime = p.assets[src]?.mtime ?? fs.statSync(abs).mtimeMs;
  const out = path.join(dir, AUDIO16_DIR, hashOf(abs, mtime) + '.wav');
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out + '.part.wav']);
  fs.renameSync(out + '.part.wav', out);
  return out;
}

// Nivel en dB de cada ventana de 10 ms.
export function levelsOf(samples, rate) {
  const win = Math.round(rate / FRAME_RATE);
  const n = Math.floor(samples.length / win);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * win; i < (f + 1) * win; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / win) / 32768;
    out[f] = rms > 0 ? 20 * Math.log10(rms) : -100;
  }
  return out;
}

// ---------- whisper ----------

// Transcribe un WAV de 16 kHz. Devuelve las palabras ya ajustadas a la voz (segundos del WAV).
export async function transcribeWav(wav, { prompt, onProgress, signal } = {}) {
  const { bin, model } = findWhisper();
  const outBase = wav.replace(/\.wav$/i, '') + '-whisper';
  const threads = Math.max(2, Math.min(8, os.cpus().length - 2));
  const args = ['-m', model, '-f', wav, '-l', 'es', '-ojf', '-of', outBase, '-t', String(threads), '-pp', '-np'];
  const preset = dtwPreset(model);
  if (preset) args.push('-dtw', preset, '-nfa'); // el DTW no funciona con flash attention
  if (prompt) args.push('--prompt', prompt);
  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd: path.dirname(bin) });
    let err = '';
    signal?.addEventListener('abort', () => child.kill());
    const onData = (d) => {
      const s = String(d);
      err = (err + s).slice(-4000);
      const m = s.match(/progress\s*=\s*(\d+)%/g);
      if (m) onProgress?.(Number(m[m.length - 1].match(/(\d+)%/)[1]) / 100);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`whisper falló (código ${code}): ${err.trim().split('\n').slice(-3).join(' · ')}`))));
  });
  const json = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8'));
  fs.rmSync(outBase + '.json', { force: true });
  const raw = wordsFromWhisper(json);
  const { samples, rate } = readWavSamples(wav);
  const mask = speechMask(levelsOf(samples, rate));
  return { words: dropHallucinations(refineWords(raw, mask)), model: path.basename(model) };
}

// ---------- caché por archivo fuente ----------

const indexFile = (dir) => path.join(dir, TRANSCRIPTS_DIR, 'index.json');

function readIndex(dir) {
  try {
    return JSON.parse(fs.readFileSync(indexFile(dir), 'utf8'));
  } catch {
    return {};
  }
}

// Archivos fuente con voz que usa el proyecto.
export function voiceSources(p) {
  return [...new Set(voiceClips(p).map((x) => x.clip.src))].filter((src) => !p.assets[src]?.missing);
}

// { src: palabras } de las fuentes ya transcritas (y no modificadas desde entonces).
export function loadSourceTranscripts(dir, p) {
  const idx = readIndex(dir);
  const out = {};
  for (const src of voiceSources(p)) {
    const e = idx[src];
    if (!e || e.mtime !== p.assets[src]?.mtime) continue;
    try {
      out[src] = dropHallucinations(JSON.parse(fs.readFileSync(path.join(dir, e.file), 'utf8')).words);
    } catch {}
  }
  return out;
}

export function pendingTranscripts(dir, p) {
  const have = loadSourceTranscripts(dir, p);
  return voiceSources(p).filter((src) => !have[src]);
}

// Transcribe un archivo fuente entero y lo guarda en la caché.
export async function transcribeSource(dir, p, src, opts = {}) {
  const wav = await sourceWav16(dir, p, src);
  const { words, model } = await transcribeWav(wav, opts);
  const rel = path.join(TRANSCRIPTS_DIR, hashOf(resolveSrc(dir, src), p.assets[src]?.mtime) + '.json');
  fs.mkdirSync(path.join(dir, TRANSCRIPTS_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), JSON.stringify({ src, mtime: p.assets[src]?.mtime, model, prompt: opts.prompt || null, words }));
  const idx = readIndex(dir);
  idx[src] = { file: rel, mtime: p.assets[src]?.mtime, model };
  fs.writeFileSync(indexFile(dir), JSON.stringify(idx, null, 2));
  return words;
}

// Escribe .editor/transcript.json con las palabras en tiempo del timeline. No hace nada si aún no
// hay ninguna fuente transcrita. Devuelve el documento (o null).
export function updateTranscript(dir, p) {
  const sources = loadSourceTranscripts(dir, p);
  if (!Object.keys(sources).length) return null;
  const pending = voiceSources(p).filter((s) => !sources[s]);
  const doc = transcriptDoc(p, sources, { pending });
  const file = path.join(dir, TRANSCRIPT_FILE);
  const text = JSON.stringify(doc, null, 1);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return doc;
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
  return doc;
}

// ---------- audio del montaje ----------

// Mezcla el audio de voz del timeline en un WAV mono de 16 kHz (sin FFmpeg ni animaciones: rápido).
// Lleva los mismos fundidos de 15 ms que la exportación en cada corte.
export async function renderVoiceTrack(dir, p, out) {
  const rate = 16000;
  const total = totalDuration(p);
  const mix = new Float32Array(Math.ceil(total * rate) + 1);
  const cache = new Map();
  const fade = Math.round(0.015 * rate);
  for (const { clip } of voiceClips(p)) {
    if (kindOf(clip.src) !== 'video' && kindOf(clip.src) !== 'audio') continue;
    if (!cache.has(clip.src)) cache.set(clip.src, readWavSamples(await sourceWav16(dir, p, clip.src)).samples);
    const s = cache.get(clip.src);
    const from = Math.round(clip.in * rate);
    const to = Math.min(s.length, Math.round((clip.in + clip.duration) * rate));
    const at = Math.round(clip.start * rate);
    const vol = clip.volume ?? 1;
    const len = to - from;
    for (let i = 0; i < len && at + i < mix.length; i++) {
      const g = Math.min(1, i / fade, (len - i) / fade);
      mix[at + i] += (s[from + i] / 32768) * vol * g;
    }
  }
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mix[i] * 32767)));
  writeWav(out, pcm, rate);
  return out;
}
