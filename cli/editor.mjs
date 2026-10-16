#!/usr/bin/env node
// CLI del editor ("Consigue tu editor de vídeo optimizado para Claude gratis"): pensada para que Claude edite proyectos sin abrir la interfaz.
// Todo lo que hace se refleja al momento en la app si el proyecto está abierto.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as P from '../core/project.mjs';
import { findProjectDir, loadProject, saveProject, initProject, syncAssets, toSrc, clipSilences, resolveSrc, contactSheet, writeProjectGuide, copyAnimationKit, run as runBin, ffmpegPath } from '../core/media.mjs';
import * as W from '../core/whisper.mjs';
import * as T from '../core/transcript.mjs';
import * as PZ from '../core/pauses.mjs';
import * as A from '../core/animate.mjs';
import * as M from '../core/music.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const HELP = `Consigue tu editor de vídeo optimizado para Claude gratis — edición de vídeo desde la terminal

Uso: <comando> [opciones]      (--project <carpeta> si no estás dentro del proyecto)
     (instalado: ConsigueTuEditor.exe --cli <comando> · desarrollo: node cli/editor.mjs <comando>)

Proyecto
  init [carpeta] [--name N] [--width 1920] [--height 1080] [--fps 30]
  info [--json]                     Pistas, clips (con ids) y medios
  check                             Busca problemas (solapes, archivos que faltan...)

Clips (tiempos en segundos o mm:ss.d)
  add <archivo> [--track v1] [--at 12.5|end] [--in 0] [--duration 5] [--volume 1] [--fit contain|cover|stretch]
  split <tiempo> [--clip c3]        Corta en ese instante (por defecto, todos los clips que pasan por ahí)
  trim <clip> [--start t] [--end t] Mueve los bordes del clip (en tiempo del timeline)
  move <clip> <tiempo> [--track v2]
  set <clip> clave=valor ...        volume, fit, in, duration, start, zoom, zoomX, zoomY
                                    zoom=1.2 acerca un 20 %; zoomX/zoomY (0-1) = hacia dónde (0.5 = centro)
                                    zoomTo=1.2 zoomTime=0.4: zoom animado (punch-in suave) de zoom a zoomTo
  delete <clip> [<clip>...] [--ripple]   --ripple cierra el hueco

Pistas
  track add video|audio [--name N]
  track remove <id>
  track set <id> clave=valor ...    name, muted=true, hidden=true, duck=true (o duck=0.2)
  music <archivo> [--volume 0.5] [--duck 0.25]
                                    Música de fondo en una pista nueva, de principio a fin del vídeo,
                                    que baja sola cuando se habla (ducking)
  music --generate [--volume 0.45] [--duck 0.25] [--seed 7]
                                    Compone una música original (lo-fi suave a 84 BPM) que dura lo
                                    que el vídeo, la guarda en media/musica-generada.mp3 y la añade igual

Silencios
  silences <clip> [--noise auto|-35] [--min 0.6] [--pad-before 0.1] [--pad-after 0.22] [--min-clip 0.8]
                                    Lista los silencios que conviene quitar. Por defecto el umbral
                                    se calcula con el ruido de fondo del clip y no deja trozos de
                                    menos de 0,8 s. Al exportar se añade un fundido corto en cada corte.
  silences <clip> ... --apply       Los quita y cierra huecos
  pauses [--apply] [--threshold -33] [--min 0.6] [--min-edge 0.4] [--keep-after 0.14] [--keep-before 0.08]
                                    Pausas muertas de todo el montaje (ventanas de 50 ms por debajo
                                    de -33 dB): de 0,6 s o más dentro de un clip y de 0,4 s o más junto
                                    a un corte (también clips enteros sin voz). Deja 0,14 s después de
                                    hablar y 0,08 s antes. Con --apply las quita en todas las pistas.

Transcripción (whisper.cpp, en español)
  transcribe [--prompt "Claude, CapCut"] [--force]
                                    Transcribe la voz y escribe .editor/transcript.json: cada palabra con
                                    su tiempo en el timeline, ajustado a la voz real. Cada archivo se
                                    transcribe una vez; después la transcripción sigue sola a los cortes.
  transcript [--from t] [--to t] [--words]
                                    La transcripción del montaje por frases (o palabra a palabra, con
                                    su número, para cut-words)
  retakes [--apply all|1,3] [--only retake,repeticion,muletilla,cortada]
                                    Tomas repetidas, palabras repetidas, muletillas y frases a medias,
                                    con el rango que conviene quitar (ajustado a los silencios)
  cut-text "desde…" ["hasta…"] [--occurrence 2] [--dry]
                                    Quita desde esa frase hasta el final de la otra (o solo esa frase)
  cut-words <n>-<m> [<n>...] [--dry]  Quita palabras por su número (ver transcript --words)
  verify [--quick]                  Revisa el montaje: palabras partidas, cortes sin pausa y tomas que
                                    quedan. Sin --quick, además vuelve a transcribir el audio cortado
                                    para ver si se entiende.
  whisper [status]                  Dónde está whisper.cpp y qué modelo usa
  whisper install --dir <carpeta> [--model medium|small] [--cpu]
                                    Descarga whisper.cpp y el modelo (cientos de MB: pregunta antes)
  whisper set [--bin whisper-cli.exe] [--model ggml-….bin]

Animaciones
  animate [--dry] [--guion media/kit/guion.mjs]
                                    Genera las animaciones del guion (ancladas a frases de la
                                    transcripción, con el kit de media/kit/) en media/anim/ y rehace las
                                    pistas Escenas (pantalla completa) y Rótulos. --dry: solo dónde caen

Ver el vídeo
  sheet <clip> [--every 2] [--from t] [--to t]
                                    Hojas de miniaturas con el segundo del timeline en cada una
  frame <tiempo> [--out archivo.png]  Fotograma compuesto (para ver cómo queda)

Revisar sin gastar
  review                            Vídeo de 360p muy ligero + audio WAV mono de 16 kHz en .editor/review/
                                    (para ver si se mira a cámara o transcribir el montaje)
  proxy                             Crea las copias ligeras que usa la preview (la app las crea sola)

Salida
  export [--out archivo.mp4]          Exporta el vídeo final (1080p, volumen normalizado a -14 LUFS)
  export --draft                      Borrador rápido de 480p para revisar el montaje entero
`;

// ---------- argumentos ----------
let flags = {};
let pos = [];
let cmd;
function parseArgs(argv) {
  flags = {};
  pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && isNaN(Number(next)))) flags[key] = true;
      else flags[key] = argv[++i];
    } else pos.push(a);
  }
  cmd = pos.shift();
}

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

function projectDir() {
  const dir = flags.project ? path.resolve(flags.project) : findProjectDir();
  if (!dir || !fs.existsSync(path.join(dir, P.PROJECT_FILE))) fail('No hay proyecto.json aquí. Usa --project <carpeta> o el comando init.');
  return dir;
}

const time = (v, name) => {
  if (v === undefined || v === true) fail(`Falta ${name}`);
  return P.parseTime(v);
};
const num = (v) => (v === undefined ? undefined : Number(v));
const s3 = (t) => (Number.isFinite(t) ? t.toFixed(3).replace(/\.?0+$/, '') || '0' : '∞');

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}
function parsePairs(list) {
  const out = {};
  for (const kv of list) {
    const i = kv.indexOf('=');
    if (i < 0) fail(`Se esperaba clave=valor y llegó "${kv}"`);
    out[kv.slice(0, i)] = parseValue(kv.slice(i + 1));
  }
  return out;
}

// Carga, aplica una operación y guarda. La app abierta lo recoge sola.
async function edit(fn) {
  const dir = projectDir();
  let p = (await syncAssets(dir, loadProject(dir))).project;
  const r = await fn(p, dir);
  p = r && r.project ? r.project : r;
  p = (await syncAssets(dir, p, { scanMedia: false })).project;
  saveProject(dir, p);
  refreshTranscript(dir, p);
  for (const w of P.validate(p)) console.log('Aviso: ' + w);
  return { p, r };
}

// La transcripción del montaje sigue a los cortes (si ya se transcribió).
function refreshTranscript(dir, p) {
  try {
    return W.updateTranscript(dir, p);
  } catch (e) {
    console.log('Aviso: no se pudo actualizar la transcripción: ' + e.message);
    return null;
  }
}

// Transcripción del montaje; si falta transcribir algo, se avisa.
function transcriptOrFail(dir, p) {
  const pending = W.pendingTranscripts(dir, p);
  const doc = refreshTranscript(dir, p);
  if (!doc) fail('Aún no hay transcripción. Usa primero el comando transcribe.');
  if (pending.length) console.log(`Aviso: sin transcribir todavía: ${pending.join(', ')} (usa transcribe)`);
  return doc;
}

const ts = (t) => P.formatTime(t);
const runFfmpeg = (args) => runBin(ffmpegPath, args);
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// Quita rangos del timeline (en todas las pistas) y guarda.
function applyCuts(dir, p, ranges) {
  const merged = T.mergeRanges(ranges);
  const before = P.totalDuration(p);
  const next = P.dropSlivers(P.removeTimeRanges(p, merged));
  saveProject(dir, next);
  refreshTranscript(dir, next);
  for (const w of P.validate(next)) console.log('Aviso: ' + w);
  console.log(`Quitados ${merged.length} tramos (${s3(before - P.totalDuration(next))}s). El vídeo dura ahora ${s3(P.totalDuration(next))}s.`);
  return next;
}

// Quita palabras (por índices) con cortes ajustados a los silencios.
function wordCut(dir, p, spans) {
  const words = transcriptOrFail(dir, p).words;
  const ranges = [];
  for (const { i, j } of spans) {
    if (!(i >= 0 && j < words.length && i <= j)) fail(`Palabras fuera de rango: ${i}-${j} (hay ${words.length})`);
    const r = T.cutRangeForWords(words, i, j);
    ranges.push(r);
    const txt = words.slice(i, j + 1).map((w) => w.w).join(' ');
    console.log(`  ${ts(r.start)} → ${ts(r.end)} (${s3(r.end - r.start)}s) palabras ${i}-${j}: "${cut(txt, 140)}"${r.tight.length ? '  ⚠ sin silencio a un lado: el corte puede notarse' : ''}`);
  }
  if (flags.dry) return console.log('(--dry: no se ha cambiado nada)');
  applyCuts(dir, p, ranges);
}

async function loadSynced() {
  const dir = projectDir();
  return { dir, p: (await syncAssets(dir, loadProject(dir))).project };
}

function progressPrinter(step = 10) {
  let shown = -1;
  return (v) => {
    const pc = Math.floor((v * 100) / step) * step;
    if (pc !== shown) console.log(`  ${(shown = pc)} %`);
  };
}

function printInfo(p) {
  console.log(`Proyecto "${p.name}" · ${p.width}x${p.height} · ${p.fps} fps · duración ${s3(P.totalDuration(p))}s`);
  const order = [...p.tracks.filter((t) => t.kind === 'video').reverse(), ...p.tracks.filter((t) => t.kind === 'audio')];
  for (const t of order) {
    const flagsTxt = [t.muted && 'silenciada', t.hidden && 'oculta', t.duck && `ducking (baja al ${Math.round((typeof t.duck === 'number' ? t.duck : 0.25) * 100)} % al hablar)`].filter(Boolean).join(', ');
    console.log(`\n[${t.id}] ${t.name} (${t.kind === 'video' ? 'vídeo' : 'audio'})${flagsTxt ? ' — ' + flagsTxt : ''}`);
    if (!t.clips.length) console.log('  (vacía)');
    for (const c of t.clips) {
      const zoomTxt = c.zoomTo != null ? `zoom ${c.zoom ?? 1}→${c.zoomTo}${c.zoomTime ? ` en ${c.zoomTime}s` : ''}` : c.zoom && c.zoom !== 1 && `zoom ${c.zoom}`;
      const extra = [c.volume != null && c.volume !== 1 && `vol ${c.volume}`, c.fit && c.fit !== 'contain' && c.fit, zoomTxt].filter(Boolean).join(' ');
      console.log(`  ${c.id.padEnd(5)} ${s3(c.start).padStart(8)} → ${s3(P.clipEnd(c)).padEnd(8)} (${s3(c.duration)}s, desde ${s3(c.in)})  ${c.src}${extra ? '  ' + extra : ''}`);
    }
  }
  const assets = Object.entries(p.assets);
  if (assets.length) {
    console.log('\nMedios:');
    for (const [src, a] of assets) {
      const parts = [a.kind, a.duration != null ? s3(a.duration) + 's' : 'duración libre', a.width && `${a.width}x${a.height}`, a.hasAudio && 'con audio', a.alpha && 'con alfa', a.missing && 'NO ENCONTRADO'];
      console.log(`  ${src} — ${parts.filter(Boolean).join(', ')}`);
    }
  }
  console.log('\n(Las pistas de vídeo se listan de arriba a abajo: la primera se ve encima.)');
}

function runElectron(args) {
  const require = createRequire(import.meta.url);
  const electron = require('electron');
  return new Promise((resolve) => {
    const child = spawn(electron, [appRoot, '--cli', ...args], { stdio: 'inherit', windowsHide: true });
    child.on('close', (code) => resolve(code));
  });
}

// ---------- comandos ----------
// Se puede llamar desde Node (node cli/editor.mjs ...) o desde la app instalada (ConsigueTuEditor.exe --cli ...).
export async function run(argv) {
  parseArgs(argv);
  try {
    await main();
  } catch (e) {
    fail(e.message);
  }
}

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;

    case 'init': {
      const dir = path.resolve(pos[0] || '.');
      const p = initProject(dir, { name: flags.name === true ? undefined : flags.name, width: num(flags.width), height: num(flags.height), fps: num(flags.fps) });
      console.log(`Proyecto creado en ${dir}`);
      printInfo(p);
      return;
    }

    case 'info': {
      const dir = projectDir();
      const { project: p, changed } = await syncAssets(dir, loadProject(dir));
      if (changed) saveProject(dir, p);
      if (flags.json) console.log(JSON.stringify({ dir, ...p }, null, 2));
      else printInfo(p);
      return;
    }

    case 'check': {
      const dir = projectDir();
      const p = (await syncAssets(dir, loadProject(dir))).project;
      const problems = P.validate(p);
      console.log(problems.length ? problems.join('\n') : 'Todo correcto.');
      return;
    }

    case 'add': {
      if (!pos[0]) fail('Indica el archivo');
      const { p, r } = await edit(async (p, dir) => {
        const abs = path.resolve(pos[0]);
        if (!fs.existsSync(abs) && !fs.existsSync(resolveSrc(dir, pos[0]))) fail(`No existe ${pos[0]}`);
        const src = fs.existsSync(abs) ? toSrc(dir, abs) : pos[0];
        p = (await syncAssets(dir, { ...p, assets: { ...p.assets, [src]: p.assets[src] } }, { scanMedia: false })).project;
        const at = flags.at === undefined || flags.at === 'end' ? undefined : time(flags.at, '--at');
        return P.addClip(p, { src, trackId: flags.track, start: at, in: flags.in ? P.parseTime(flags.in) : 0, duration: flags.duration ? P.parseTime(flags.duration) : undefined, volume: num(flags.volume), fit: flags.fit });
      });
      const c = P.findClip(p, r.clipId).clip;
      console.log(`Añadido ${c.id}: ${c.src} en ${s3(c.start)} → ${s3(P.clipEnd(c))}`);
      return;
    }

    case 'split': {
      const t = time(pos[0], 'el tiempo');
      await edit((p) => (flags.clip ? P.splitClip(p, flags.clip, t).project : P.splitAt(p, t, flags.track ? [flags.track] : undefined)));
      console.log(`Cortado en ${s3(t)}s`);
      return;
    }

    case 'trim': {
      if (!pos[0]) fail('Indica el clip');
      const { p } = await edit((p) => P.trimClip(p, pos[0], { start: flags.start !== undefined ? time(flags.start) : undefined, end: flags.end !== undefined ? time(flags.end) : undefined }));
      const c = P.findClip(p, pos[0]).clip;
      console.log(`${c.id}: ${s3(c.start)} → ${s3(P.clipEnd(c))} (desde ${s3(c.in)})`);
      return;
    }

    case 'move': {
      if (!pos[0]) fail('Indica el clip');
      const { p } = await edit((p) => P.moveClip(p, pos[0], time(pos[1], 'el tiempo'), flags.track));
      const f = P.findClip(p, pos[0]);
      console.log(`${f.clip.id} en [${f.track.id}] ${s3(f.clip.start)} → ${s3(P.clipEnd(f.clip))}`);
      return;
    }

    case 'set': {
      if (!pos[0]) fail('Indica el clip');
      const patch = parsePairs(pos.slice(1));
      await edit((p) => P.updateClip(p, pos[0], patch));
      console.log(`${pos[0]} actualizado`);
      return;
    }

    case 'delete': {
      if (!pos.length) fail('Indica al menos un clip');
      await edit((p) => (flags.ripple ? P.rippleDeleteClips(p, pos) : P.deleteClips(p, pos)));
      console.log(`Borrado: ${pos.join(', ')}${flags.ripple ? ' (todo lo de detrás se ha adelantado)' : ''}`);
      return;
    }

    case 'track': {
      const sub = pos.shift();
      if (sub === 'add') {
        const { r } = await edit((p) => P.addTrack(p, pos[0] === 'audio' ? 'audio' : 'video', flags.name === true ? undefined : flags.name));
        console.log(`Pista creada: ${r.trackId}`);
      } else if (sub === 'remove') {
        await edit((p) => P.removeTrack(p, pos[0]));
        console.log(`Pista eliminada: ${pos[0]}`);
      } else if (sub === 'set') {
        const id = pos.shift();
        await edit((p) => P.updateTrack(p, id, parsePairs(pos)));
        console.log(`Pista ${id} actualizada`);
      } else fail('Uso: track add|remove|set');
      return;
    }

    case 'silences': {
      if (!pos[0]) fail('Indica el clip');
      const dir = projectDir();
      const p = (await syncAssets(dir, loadProject(dir))).project;
      const f = P.findClip(p, pos[0]);
      if (!f) fail(`No existe el clip ${pos[0]}`);
      const opts = { noise: flags.noise === undefined || flags.noise === 'auto' ? 'auto' : num(flags.noise), minDuration: num(flags.min), minClip: num(flags['min-clip']), padBefore: num(flags['pad-before']), padAfter: num(flags['pad-after']) };
      for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
      const { noise, ranges } = await clipSilences(dir, p, f.clip, opts);
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      console.log(`${ranges.length} silencios en ${f.clip.id} (umbral ${noise} dB; ${s3(total)}s en total, en tiempo del timeline):`);
      for (const r of ranges) console.log(`  ${s3(r.start)} → ${s3(r.end)}  (${s3(r.end - r.start)}s)`);
      if (flags.apply && ranges.length) {
        saveProject(dir, P.removeRanges(p, f.clip.id, ranges));
        refreshTranscript(dir, loadProject(dir));
        console.log(`Quitados. El vídeo dura ahora ${s3(P.totalDuration(loadProject(dir)))}s.`);
      }
      return;
    }

    case 'pauses': {
      const { dir, p } = await loadSynced();
      const audio = {};
      for (const src of W.voiceSources(p)) audio[src] = W.readWavSamples(await W.sourceWav16(dir, p, src));
      if (!Object.keys(audio).length) fail('No hay clips con voz en el proyecto');
      const opts = { threshold: num(flags.threshold), minInside: num(flags.min), minEdge: num(flags['min-edge']), keepAfter: num(flags['keep-after']), keepBefore: num(flags['keep-before']) };
      for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
      const o = { ...PZ.PAUSE_DEFAULTS, ...opts };
      const { levels, edges } = PZ.timelineLevels(p, audio);
      const ranges = PZ.findPauses(levels, { ...o, edges });
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      console.log(`${ranges.length} pausas muertas (por debajo de ${o.threshold} dB; ${s3(total)}s en total). Se deja ${s3(o.keepAfter)}s después de hablar y ${s3(o.keepBefore)}s antes:`);
      for (const r of ranges) console.log(`  ${ts(r.start)} → ${ts(r.end)}  (quita ${s3(r.end - r.start)}s de una pausa de ${s3(r.length)}s${r.edge ? ', junto a un corte' : ''})`);
      if (!flags.apply) return ranges.length && console.log('\nPara quitarlas: pauses --apply');
      if (ranges.length) applyCuts(dir, p, ranges);
      return;
    }

    case 'animate': {
      const { dir, p } = await loadSynced();
      const copied = copyAnimationKit(dir);
      if (copied.length) console.log(`Kit de animaciones copiado en media/kit/: ${copied.join(', ')}`);
      const file = path.resolve(dir, flags.guion && flags.guion !== true ? flags.guion : path.join('media', 'kit', 'guion.mjs'));
      if (!fs.existsSync(file)) fail(`No existe el guion ${file}`);
      if (copied.includes('guion.mjs')) console.log('Aviso: media/kit/guion.mjs es un ejemplo; cambia sus frases por las de tu vídeo.');
      const mod = await import(pathToFileURL(file).href + '?' + Date.now());
      let guion = mod.guion ?? mod.default;
      if (typeof guion === 'function') guion = guion(A.pieces);
      if (!Array.isArray(guion)) fail(`${path.basename(file)} tiene que exportar "guion" (una lista de animaciones)`);
      const doc = transcriptOrFail(dir, p);
      const { placed, skipped } = A.layoutGuion(guion, doc.words, { total: P.totalDuration(p), aliases: { ...A.DEFAULT_ALIASES, ...(mod.aliases || {}) } });
      const out = [];
      for (const x of placed) {
        try {
          x.html = A.animationPage(x.g.html({ ...A.pieces, dur: x.dur, t: x.t }), x.dur);
          x.file = `media/anim/${x.g.id}.html`;
          out.push(x);
        } catch (e) {
          skipped.push({ g: x.g, reason: e.message });
        }
      }
      for (const x of out) console.log(`${x.g.kind === 'escena' ? 'ESCENA' : 'rótulo'}  ${ts(x.start)}  ${x.dur.toFixed(1).padStart(5)}s  ${x.g.id}`);
      for (const s of skipped) console.log(`Aviso: ${s.g.id} no se coloca (${s.reason})`);
      const nScenes = out.filter((x) => x.g.kind === 'escena').length;
      if (flags.dry) return console.log(`\n${nScenes} escenas y ${out.length - nScenes} rótulos (--dry: no se ha cambiado nada)`);
      const animDir = path.join(dir, 'media', 'anim');
      fs.mkdirSync(animDir, { recursive: true });
      for (const x of out) fs.writeFileSync(path.join(dir, x.file), x.html);
      // borra las animaciones generadas que ya no están en el guion (las hechas a mano no se tocan)
      for (const f of fs.readdirSync(animDir)) {
        const abs = path.join(animDir, f);
        if (f.endsWith('.html') && !out.some((x) => x.file === `media/anim/${f}`) && fs.readFileSync(abs, 'utf8').includes(A.GENERATED_MARK)) fs.rmSync(abs);
      }
      await edit(async (p) => {
        // pistas por nombre: Escenas (pantalla completa) y Rótulos encima; su contenido lo genera el guion
        const track = (name) => {
          let t = p.tracks.find((t) => t.kind === 'video' && t.name === name);
          if (!t) {
            const r = P.addTrack(p, 'video', name);
            p = r.project;
            t = P.findTrack(p, r.trackId);
          }
          return t.id;
        };
        const ids = { escena: track('Escenas'), rotulo: track('Rótulos') };
        p = P.clone(p);
        for (const t of p.tracks) if (t.id === ids.escena || t.id === ids.rotulo) t.clips = [];
        p = (await syncAssets(dir, p)).project;
        for (const x of out) {
          const t = P.findTrack(p, x.g.kind === 'escena' ? ids.escena : ids.rotulo);
          t.clips.push({ id: P.nextId(p, 'k'), src: x.file, start: x.start, in: 0, duration: x.dur });
        }
        return P.normalize(p);
      });
      console.log(`\n${nScenes} escenas y ${out.length - nScenes} rótulos colocados en las pistas Escenas y Rótulos.`);
      return;
    }

    case 'sheet': {
      if (!pos[0]) fail('Indica el clip');
      const dir = projectDir();
      const p = (await syncAssets(dir, loadProject(dir))).project;
      const f = P.findClip(p, pos[0]);
      if (!f) fail(`No existe el clip ${pos[0]}`);
      const every = num(flags.every) ?? 2;
      const pages = await contactSheet(dir, p, f.clip, {
        every,
        from: flags.from !== undefined ? time(flags.from) : undefined,
        to: flags.to !== undefined ? time(flags.to) : undefined,
        out: path.join(dir, '.editor', 'sheets', f.clip.id),
      });
      console.log(`${pages.length} hojas de ${f.clip.id} (una miniatura cada ${every}s, 6x5 por hoja, el número es el segundo del timeline):`);
      for (const pg of pages) console.log(`  ${pg.file}  (${s3(pg.from)} → ${s3(pg.to)})`);
      return;
    }

    case 'whisper': {
      const sub = pos[0] || 'status';
      if (sub === 'install') {
        if (!flags.dir || flags.dir === true) fail('Indica dónde instalarlo: whisper install --dir <carpeta> (mejor en un disco con espacio libre)');
        await W.installWhisper({ dir: flags.dir, model: flags.model && flags.model !== true ? flags.model : 'medium', gpu: !flags.cpu });
        console.log(`Instalado.`);
      } else if (sub === 'set') {
        const cfg = W.readWhisperConfig();
        if (flags.bin && flags.bin !== true) cfg.bin = path.resolve(flags.bin);
        if (flags.model && flags.model !== true) cfg.model = path.resolve(flags.model);
        W.saveWhisperConfig(cfg);
        console.log(`Guardado en ${W.whisperConfigFile()}`);
      } else if (sub !== 'status') fail('Uso: whisper [status|install|set]');
      try {
        const w = W.findWhisper();
        console.log(`whisper.cpp: ${w.bin}\nModelo: ${w.model} (alineación por palabra: ${W.dtwPreset(w.model) || 'no'})`);
      } catch (e) {
        console.log(e.message);
      }
      return;
    }

    case 'transcribe': {
      const { dir, p } = await loadSynced();
      W.findWhisper();
      if (!W.voiceSources(p).length) fail('No hay clips con voz en el proyecto');
      const todo = flags.force ? W.voiceSources(p) : W.pendingTranscripts(dir, p);
      for (const src of todo) {
        console.log(`Transcribiendo ${src} (${s3(p.assets[src]?.duration)}s)…`);
        const t0 = Date.now();
        const words = await W.transcribeSource(dir, p, src, { prompt: flags.prompt && flags.prompt !== true ? flags.prompt : undefined, onProgress: progressPrinter() });
        console.log(`  ${words.length} palabras en ${Math.round((Date.now() - t0) / 1000)}s`);
      }
      if (!todo.length) console.log('Ya estaba todo transcrito (--force para repetir).');
      const doc = refreshTranscript(dir, p);
      console.log(`Transcripción del montaje: ${path.join(dir, W.TRANSCRIPT_FILE)} (${doc.words.length} palabras, ${doc.phrases.length} frases)`);
      const partidas = doc.words.filter((w) => w.cut).length;
      if (partidas) console.log(`Aviso: ${partidas} palabras quedan partidas por un corte (mira verify --quick)`);
      return;
    }

    case 'transcript': {
      const { dir, p } = await loadSynced();
      const doc = transcriptOrFail(dir, p);
      const from = flags.from !== undefined ? time(flags.from) : 0;
      const to = flags.to !== undefined ? time(flags.to) : Infinity;
      if (flags.words) {
        for (const w of doc.words) if (w.end > from && w.start < to) console.log(`${String(w.i).padStart(5)}  ${ts(w.start)} → ${ts(w.end)}  ${w.w}${w.cut ? '  [partida]' : ''}${w.doubt ? '  [?]' : ''}`);
      } else {
        for (const ph of doc.phrases) if (ph.end > from && ph.start < to) console.log(`[${ts(ph.start)} → ${ts(ph.end)}] (${ph.words[0]}-${ph.words[1]}) ${ph.text}`);
      }
      return;
    }

    case 'retakes': {
      const { dir, p } = await loadSynced();
      const doc = transcriptOrFail(dir, p);
      let list = T.findRetakes(doc.words);
      if (flags.only && flags.only !== true) {
        const only = String(flags.only).split(',');
        list = list.filter((r) => only.includes(r.type));
      }
      if (!list.length) return console.log('No hay tomas repetidas ni frases a medias.');
      const label = { retake: 'TOMA REPETIDA', repeticion: 'repetición', muletilla: 'muletilla', cortada: 'frase a medias' };
      console.log(`${list.length} propuestas (rangos del timeline; ya dejan una pausa natural):`);
      list.forEach((r, k) => {
        console.log(`\n${k + 1}. [${label[r.type]}] ${ts(r.start)} → ${ts(r.end)} (${s3(r.end - r.start)}s) palabras ${r.words[0]}-${r.words[1]}${r.tight ? '  ⚠ sin silencio a un lado' : ''}`);
        console.log(`   ${r.reason}`);
        console.log(`   quitar: "${cut(r.text, 160)}"`);
        if (r.keep) console.log(`   se queda: "${cut(r.keep.text, 120)}"`);
      });
      if (!flags.apply) return console.log('\nPara quitarlas: retakes --apply all (todas menos las frases a medias) o --apply 1,3');
      const pick = flags.apply === true || flags.apply === 'all' ? list.filter((r) => r.type !== 'cortada') : String(flags.apply).split(',').map((n) => list[Number(n) - 1]).filter(Boolean);
      if (!pick.length) fail('Nada que aplicar (las frases a medias solo se quitan por número)');
      console.log('');
      applyCuts(dir, p, pick);
      return;
    }

    case 'cut-text': {
      if (!pos[0]) fail('Uso: cut-text "desde…" ["hasta…"]');
      const { dir, p } = await loadSynced();
      const doc = transcriptOrFail(dir, p);
      const span = T.findSpan(doc.words, pos[0], pos[1], { occurrence: num(flags.occurrence) ?? 1 });
      if (!span) fail(`No encuentro "${pos[0]}"${pos[1] ? ` seguido de "${pos[1]}"` : ''} en la transcripción (prueba con menos palabras o mira transcript)`);
      if (span.matches > 1 && flags.occurrence === undefined) console.log(`Aviso: "${pos[0]}" aparece ${span.matches} veces; uso la primera (--occurrence N para otra).`);
      wordCut(dir, p, [span]);
      return;
    }

    case 'cut-words': {
      if (!pos.length) fail('Uso: cut-words 120-135 [200-204 ...]');
      const { dir, p } = await loadSynced();
      wordCut(dir, p, pos.map((x) => {
        const [a, b] = String(x).split('-').map(Number);
        return { i: a, j: Number.isFinite(b) ? b : a };
      }));
      return;
    }

    case 'verify': {
      const { dir, p } = await loadSynced();
      const doc = transcriptOrFail(dir, p);
      const report = { cuts: T.cutProblems(p, doc.words), retakes: T.findRetakes(doc.words).filter((r) => r.type !== 'muletilla') };
      console.log(`Cortes: ${report.cuts.length ? report.cuts.length + ' posibles problemas' : 'bien'}`);
      for (const c of report.cuts) console.log(`  ${ts(c.start)}  ${c.reason}`);
      console.log(`Tomas repetidas o frases a medias que quedan: ${report.retakes.length || 'ninguna'}`);
      for (const r of report.retakes) console.log(`  ${ts(r.start)}  ${r.reason}: "${cut(r.text, 100)}"`);
      if (!flags.quick) {
        const wav = path.join(dir, '.editor', 'verify', 'montaje.wav');
        console.log('Mezclando el audio del montaje y volviendo a transcribirlo…');
        await W.renderVoiceTrack(dir, p, wav);
        const { words: heard } = await W.transcribeWav(wav, { onProgress: progressPrinter(25) });
        report.heard = heard;
        report.diffs = T.diffWords(doc.words, heard).filter((d) => !d.minor);
        report.heardRetakes = T.findRetakes(heard).filter((r) => r.type === 'retake' || r.type === 'repeticion');
        console.log(`Al volver a escucharlo: ${report.diffs.length ? report.diffs.length + ' tramos no se oyen como se esperaba' : 'se entiende igual que el original'}`);
        for (const d of report.diffs) console.log(`  ${ts(d.start)}  se esperaba "${cut(d.expected.join(' '), 80)}" y se oye "${cut(d.heard.join(' '), 80)}"${d.big ? '  ⚠ diferencia grande' : ''}`);
        if (report.heardRetakes.length) console.log(`Repeticiones que se oyen en el montaje: ${report.heardRetakes.length}`);
        for (const r of report.heardRetakes) console.log(`  ${ts(r.start)}  "${cut(r.text, 100)}"`);
      }
      const file = path.join(dir, '.editor', 'verify', 'report.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(report, null, 1));
      console.log(`Informe completo: ${file}`);
      return;
    }

    case 'music': {
      if (!pos[0] && !flags.generate) fail('Indica el archivo de música (o --generate para componer una)');
      // duración del vídeo sin contar la música que ya hubiera
      const videoLength = (p) => P.totalDuration({ ...p, tracks: p.tracks.filter((t) => !t.duck) });
      let file = pos[0];
      if (flags.generate) {
        const { dir, p } = await loadSynced();
        const total = videoLength(p);
        if (!(total > 0)) fail('El proyecto está vacío: añade antes el vídeo');
        console.log(`Componiendo ${s3(total)}s de música lo-fi a ${M.LOFI.bpm} BPM…`);
        const song = M.composeLofi(total, { seed: num(flags.seed) ?? 7 });
        const wav = path.join(dir, '.editor', 'music', 'musica-generada.wav');
        file = path.join(dir, 'media', 'musica-generada.mp3');
        fs.mkdirSync(path.dirname(wav), { recursive: true });
        fs.writeFileSync(wav, M.stereoWav(song.left, song.right, song.sampleRate));
        await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', file]);
        fs.rmSync(wav);
        console.log(`Música: ${file} (${song.bars} compases; original, sin derechos de terceros)`);
      }
      const { p, r } = await edit(async (p, dir) => {
        const abs = path.resolve(file);
        if (!fs.existsSync(abs) && !fs.existsSync(resolveSrc(dir, file))) fail(`No existe ${file}`);
        const src = fs.existsSync(abs) ? toSrc(dir, abs) : file;
        // al volver a componerla, sustituye a la anterior en vez de apilar pistas
        p = { ...p, tracks: p.tracks.filter((t) => !(t.kind === 'audio' && t.clips.length && t.clips.every((c) => c.src === src))) };
        p = (await syncAssets(dir, { ...p, assets: { ...p.assets, [src]: undefined } }, { scanMedia: false })).project;
        const total = videoLength(p);
        const tr = P.addTrack(p, 'audio', 'Música');
        const duck = flags.duck === undefined || flags.duck === true ? true : Number(flags.duck);
        const added = P.addClip(P.updateTrack(tr.project, tr.trackId, { duck }), { src, trackId: tr.trackId, start: 0, duration: total > 0 ? total : undefined, volume: num(flags.volume) ?? (flags.generate ? 0.45 : 0.5) });
        return { project: added.project, clipId: added.clipId, trackId: tr.trackId };
      });
      const c = P.findClip(p, r.clipId).clip;
      console.log(`Música en la pista ${r.trackId} (${c.id}): ${s3(c.start)} → ${s3(P.clipEnd(c))}, volumen ${c.volume}; baja sola cuando se habla`);
      if (P.clipEnd(c) < P.totalDuration(p) - 0.5) console.log(`Aviso: la canción dura menos que el vídeo; pon otra detrás con add <archivo> --track ${r.trackId}`);
      return;
    }

    case 'guide': {
      const dir = projectDir();
      writeProjectGuide(dir);
      console.log(`CLAUDE.md actualizado en ${dir}`);
      return;
    }

    case 'frame': {
      const dir = projectDir();
      const out = path.resolve(flags.out && flags.out !== true ? flags.out : path.join(dir, '.editor', `frame-${pos[0] || 0}.png`));
      process.exit(await runElectron(['frame', '--project', dir, '--time', String(pos[0] || 0), '--out', out]));
    }

    case 'export': {
      const dir = projectDir();
      const args = ['export', '--project', dir];
      if (flags.out && flags.out !== true) args.push('--out', path.resolve(flags.out));
      if (flags.draft) args.push('--draft');
      if (flags.review) args.push('--review');
      process.exit(await runElectron(args));
    }

    case 'review':
    case 'proxy':
      process.exit(await runElectron([cmd, '--project', projectDir()]));

    default:
      fail(`Comando desconocido "${cmd}". Usa el comando help.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run(process.argv.slice(2));
