#!/usr/bin/env node
// CLI de CupCut: pensada para que Claude edite proyectos sin abrir la interfaz.
// Todo lo que hace se refleja al momento en la app si el proyecto está abierto.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as P from '../core/project.mjs';
import { findProjectDir, loadProject, saveProject, initProject, syncAssets, toSrc, clipSilences, resolveSrc, contactSheet, writeProjectGuide } from '../core/media.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const HELP = `CupCut — edición de vídeo desde la terminal

Uso: cupcut <comando> [opciones]      (--project <carpeta> si no estás dentro del proyecto)

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
  delete <clip> [<clip>...] [--ripple]   --ripple cierra el hueco

Pistas
  track add video|audio [--name N]
  track remove <id>
  track set <id> clave=valor ...    name, muted=true, hidden=true

Silencios
  silences <clip> [--noise -35] [--min 0.5] [--pad 0.12]   Solo los lista
  silences <clip> ... --apply                              Los quita y cierra huecos

Ver el vídeo
  sheet <clip> [--every 2] [--from t] [--to t]
                                    Hojas de miniaturas con el segundo del timeline en cada una
  frame <tiempo> [--out archivo.png]  Fotograma compuesto (para ver cómo queda)

Salida
  export [--out archivo.mp4]          Exporta el vídeo final
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
  if (!dir || !fs.existsSync(path.join(dir, P.PROJECT_FILE))) fail('No hay proyecto.json aquí. Usa --project <carpeta> o "cupcut init".');
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
  for (const w of P.validate(p)) console.log('Aviso: ' + w);
  return { p, r };
}

function printInfo(p) {
  console.log(`Proyecto "${p.name}" · ${p.width}x${p.height} · ${p.fps} fps · duración ${s3(P.totalDuration(p))}s`);
  const order = [...p.tracks.filter((t) => t.kind === 'video').reverse(), ...p.tracks.filter((t) => t.kind === 'audio')];
  for (const t of order) {
    const flagsTxt = [t.muted && 'silenciada', t.hidden && 'oculta'].filter(Boolean).join(', ');
    console.log(`\n[${t.id}] ${t.name} (${t.kind === 'video' ? 'vídeo' : 'audio'})${flagsTxt ? ' — ' + flagsTxt : ''}`);
    if (!t.clips.length) console.log('  (vacía)');
    for (const c of t.clips) {
      const extra = [c.volume != null && c.volume !== 1 && `vol ${c.volume}`, c.fit && c.fit !== 'contain' && c.fit].filter(Boolean).join(' ');
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
// Se puede llamar desde Node (node cli/cupcut.mjs ...) o desde la app instalada (CupCut.exe --cli ...).
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
      await edit((p) => P.deleteClips(p, pos, { ripple: !!flags.ripple }));
      console.log(`Borrado: ${pos.join(', ')}${flags.ripple ? ' (huecos cerrados)' : ''}`);
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
      const ranges = await clipSilences(dir, p, f.clip, { noise: num(flags.noise) ?? -35, minDuration: num(flags.min) ?? 0.5, pad: num(flags.pad) ?? 0.12 });
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      console.log(`${ranges.length} silencios en ${f.clip.id} (${s3(total)}s en total, en tiempo del timeline):`);
      for (const r of ranges) console.log(`  ${s3(r.start)} → ${s3(r.end)}  (${s3(r.end - r.start)}s)`);
      if (flags.apply && ranges.length) {
        saveProject(dir, P.removeRanges(p, f.clip.id, ranges));
        console.log(`Quitados. El vídeo dura ahora ${s3(P.totalDuration(loadProject(dir)))}s.`);
      }
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
        out: path.join(dir, '.cupcut', 'sheets', f.clip.id),
      });
      console.log(`${pages.length} hojas de ${f.clip.id} (una miniatura cada ${every}s, 6x5 por hoja, el número es el segundo del timeline):`);
      for (const pg of pages) console.log(`  ${pg.file}  (${s3(pg.from)} → ${s3(pg.to)})`);
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
      const out = path.resolve(flags.out && flags.out !== true ? flags.out : path.join(dir, '.cupcut', `frame-${pos[0] || 0}.png`));
      process.exit(await runElectron(['frame', '--project', dir, '--time', String(pos[0] || 0), '--out', out]));
    }

    case 'export': {
      const dir = projectDir();
      const args = ['export', '--project', dir];
      if (flags.out && flags.out !== true) args.push('--out', path.resolve(flags.out));
      process.exit(await runElectron(args));
    }

    default:
      fail(`Comando desconocido "${cmd}". Usa "cupcut help".`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) run(process.argv.slice(2));
