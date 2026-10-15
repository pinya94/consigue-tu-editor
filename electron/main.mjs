// Proceso principal de Electron: ventana, diálogos, disco, vigilancia del proyecto y exportación.
// También tiene un modo sin ventana (--cli) que usa la CLI para exportar y sacar fotogramas.
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMediaServer } from './server.mjs';
import { makeHtmlRenderer } from './htmlRender.mjs';
import { APP_NAME, loadProject, saveProject, initProject, syncAssets, toSrc, probe, clipSilences, projectFile, findProjectDir, serialize, writeProjectGuide } from '../core/media.mjs';
import { exportProject, exportFrame, PRESETS } from '../core/export.mjs';
import { readProxies, pendingProxies, makeProxy } from '../core/proxy.mjs';
import { findClip, kindOf, parseTime, PROJECT_FILE } from '../core/project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliMode = process.argv.includes('--cli');

let media;
let win;
let current = null; // { dir, lastWritten, watcher }
let exportAbort = null;

// ---------- Ajustes (proyectos recientes) ----------

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function readConfig() {
  // la primera vez se recuperan los proyectos recientes de cuando la app se llamaba "cupcut"
  const old = path.join(app.getPath('appData'), 'cupcut', 'config.json');
  const aux = cliMode || process.env.EDITOR_SNAPSHOT;
  for (const f of aux ? [configPath()] : [configPath(), old]) {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {}
  }
  return { recent: [] };
}
function rememberProject(dir) {
  const cfg = readConfig();
  cfg.recent = [dir, ...(cfg.recent || []).filter((d) => d !== dir)].slice(0, 8);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// ---------- Proyecto abierto ----------

function send(channel, payload) {
  win?.webContents.send(channel, payload);
}

function write(p) {
  current.lastWritten = saveProject(current.dir, p);
}

async function openProject(dir) {
  closeProject();
  let p = loadProject(dir);
  const synced = await syncAssets(dir, p);
  p = synced.project;
  current = { dir, lastWritten: fs.readFileSync(projectFile(dir), 'utf8'), watcher: null };
  if (synced.changed) write(p);
  try {
    writeProjectGuide(dir); // mantiene al día las instrucciones para Claude
  } catch {}
  watch(dir);
  rememberProject(dir);
  queueProxies();
  win?.setTitle(`${p.name} — ${APP_NAME}`);
  return { dir, project: p };
}

function closeProject() {
  current?.watcher?.close();
  current = null;
}

// Vigila la carpeta: cambios en proyecto.json hechos por Claude (o a mano) y archivos nuevos en media/.
function watch(dir) {
  let timer = null;
  let projectChanged = false;
  let mediaChanged = false;
  current.watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
    if (!file) return;
    const f = String(file).split(path.sep).join('/');
    if (f === PROJECT_FILE) projectChanged = true;
    else if (f.startsWith('media/')) mediaChanged = true;
    else return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const c = current;
      if (!c || c.dir !== dir) return;
      const wasMedia = mediaChanged;
      projectChanged = mediaChanged = false;
      try {
        if (!fs.existsSync(projectFile(dir))) return;
        const text = fs.readFileSync(projectFile(dir), 'utf8');
        // es nuestra propia escritura y no hay archivos nuevos: nada que hacer
        if (!wasMedia && text === c.lastWritten) return;
        let p = loadProject(dir);
        const synced = await syncAssets(dir, p);
        p = synced.project;
        if (synced.changed) write(p);
        else c.lastWritten = text;
        send('project:external', p);
        queueProxies();
      } catch (e) {
        // JSON a medio escribir o con errores: se avisa y se espera al siguiente cambio
        send('app:error', `No se pudo leer ${PROJECT_FILE}: ${e.message}`);
      }
    }, 200);
  });
}

// ---------- Copias ligeras para la preview ----------

let proxyJob = null;

// Crea, de una en una y en segundo plano, las copias ligeras que falten.
function queueProxies() {
  if (proxyJob || !current) return;
  const dir = current.dir;
  proxyJob = (async () => {
    try {
      for (;;) {
        if (!current || current.dir !== dir) break;
        const p = loadProject(dir);
        const src = pendingProxies(dir, p)[0];
        if (!src) break;
        send('proxy:progress', { src, value: 0 });
        await makeProxy(dir, p, src, { onProgress: (value) => send('proxy:progress', { src, value }) });
        send('proxy:ready', readProxies(dir, p));
      }
    } catch (e) {
      send('app:error', e.message);
    } finally {
      proxyJob = null;
      send('proxy:progress', null);
    }
  })();
}

// ---------- Ventana ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#15161a',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F5') win.webContents.reload();
  });
  if (process.env.EDITOR_DEV_URL) win.loadURL(process.env.EDITOR_DEV_URL);
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));

  // Para revisar la interfaz sin mirar la pantalla: EDITOR_SNAPSHOT=captura.png electron . --project <dir>
  // Opcionalmente EDITOR_SNAPSHOT_JS ejecuta código en la interfaz antes de la captura.
  if (process.env.EDITOR_SNAPSHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.EDITOR_SNAPSHOT_JS) {
        const result = await win.webContents.executeJavaScript(process.env.EDITOR_SNAPSHOT_JS).catch((e) => console.error(e));
        if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result));
        await new Promise((r) => setTimeout(r, 1500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(process.env.EDITOR_SNAPSHOT), img.toPNG());
      app.exit(0);
    });
  }
}

function registerIpc() {
  ipcMain.handle('app:info', () => {
    const dirArg = process.argv.find((a, i) => process.argv[i - 1] === '--project');
    return { mediaBase: media.base, recent: (readConfig().recent || []).filter((d) => fs.existsSync(projectFile(d))), openOnStart: dirArg ? path.resolve(dirArg) : null };
  });

  ipcMain.handle('project:open', async (_e, dir) => {
    if (!dir) {
      const r = await dialog.showOpenDialog(win, { title: 'Abrir proyecto (carpeta con proyecto.json)', properties: ['openDirectory'] });
      if (r.canceled) return null;
      dir = r.filePaths[0];
      if (!fs.existsSync(projectFile(dir))) {
        const found = findProjectDir(dir);
        if (!found) throw new Error('Esa carpeta no tiene un proyecto.json. Usa "Nuevo proyecto".');
        dir = found;
      }
    }
    return openProject(dir);
  });

  ipcMain.handle('project:new', async (_e, opts = {}) => {
    const r = await dialog.showOpenDialog(win, { title: 'Elige una carpeta vacía para el proyecto', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    const dir = r.filePaths[0];
    initProject(dir, opts);
    return openProject(dir);
  });

  ipcMain.handle('project:save', (_e, p) => {
    if (!current) return;
    const text = serialize(p);
    if (text === current.lastWritten) return;
    write(p);
  });

  ipcMain.handle('media:import', async (_e, paths) => {
    if (!current) return {};
    if (!paths) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Importar archivos',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Medios', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'html'] }],
      });
      if (r.canceled) return {};
      paths = r.filePaths;
    }
    const assets = {};
    for (const abs of paths) {
      if (!kindOf(abs)) continue;
      try {
        assets[toSrc(current.dir, abs)] = await probe(abs);
      } catch (e) {
        send('app:error', `No se pudo importar ${path.basename(abs)}: ${e.message}`);
      }
    }
    return assets;
  });

  ipcMain.handle('silences:detect', async (_e, { project, clipId, opts }) => {
    const f = findClip(project, clipId);
    if (!f) throw new Error('Clip no encontrado');
    return clipSilences(current.dir, project, f.clip, opts);
  });

  ipcMain.handle('proxy:list', (_e, project) => (current ? readProxies(current.dir, project) : {}));

  // preset 'final' pregunta dónde guardar; 'draft' (borrador rápido) se guarda directamente en export/
  ipcMain.handle('export:run', async (_e, { project, preset = 'final' }) => {
    let out = path.join(current.dir, 'export', `${project.name}${preset === 'final' ? '' : '-borrador'}.mp4`);
    if (preset === 'final') {
      const r = await dialog.showSaveDialog(win, { title: 'Exportar vídeo', defaultPath: out, filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }] });
      if (r.canceled) return null;
      out = r.filePath;
    }
    exportAbort = new AbortController();
    const logFile = path.join(current.dir, '.editor', 'export.log');
    const { renderHtml, cleanCache } = makeHtmlRenderer({ dir: current.dir, project, urlFor: media.urlFor });
    try {
      await exportProject({ dir: current.dir, project, out, preset, logFile, renderHtml, signal: exportAbort.signal, onProgress: (pr) => send('export:progress', pr) });
      cleanCache();
    } catch (e) {
      const err = new Error(`${e.message}||${logFile}`);
      throw err;
    } finally {
      exportAbort = null;
    }
    return out;
  });
  ipcMain.handle('export:cancel', () => exportAbort?.abort());

  ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
}

// ---------- Modo CLI (sin ventana) ----------
// ConsigueTuEditor.exe --cli <comando> ...   (en desarrollo: electron . --cli <comando> ...)
// export y frame necesitan Chromium para las animaciones y se resuelven aquí; el resto lo hace cli/editor.mjs.

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runCli() {
  const args = process.argv.slice(process.argv.indexOf('--cli') + 1);
  const cmd = args[0];
  if (cmd !== 'export' && cmd !== 'frame' && cmd !== 'review' && cmd !== 'proxy') {
    const { run } = await import('../cli/editor.mjs');
    await run(args);
    return;
  }
  const dir = arg('project') ? path.resolve(arg('project')) : findProjectDir();
  if (!dir) throw new Error('No hay proyecto.json aquí. Usa --project <carpeta>.');
  let p = loadProject(dir);
  p = (await syncAssets(dir, p)).project;
  const { renderHtml, renderHtmlFrame, cleanCache } = makeHtmlRenderer({ dir, project: p, urlFor: media.urlFor });
  let last = '';
  const onProgress = (pr) => {
    const line = `${pr.label}: ${Math.round(pr.value * 100)}%`;
    if (line !== last && Math.round(pr.value * 100) % 10 === 0) console.log(line);
    last = line;
  };
  const logFile = path.join(dir, '.editor', 'export.log');
  const fail = (e) => {
    throw new Error(`${e.message}\nRegistro completo: ${logFile}`);
  };
  if (cmd === 'export') {
    const preset = process.argv.includes('--draft') ? 'draft' : process.argv.includes('--review') ? 'review' : 'final';
    const out = path.resolve(arg('out') || path.join(dir, 'export', `${p.name}${preset === 'final' ? '' : '-' + preset}.mp4`));
    await exportProject({ dir, project: p, out, preset, logFile, renderHtml, onProgress }).catch(fail);
    cleanCache();
    console.log(`Exportado (${PRESETS[preset].label}): ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
  } else if (cmd === 'review') {
    // versión mínima para revisar el montaje: vídeo de 360p y el audio en WAV mono de 16 kHz
    const out = path.join(dir, '.editor', 'review', 'review.mp4');
    const audioOut = path.join(dir, '.editor', 'review', 'review.wav');
    await exportProject({ dir, project: p, out, preset: 'review', audioOut, logFile, renderHtml, onProgress }).catch(fail);
    console.log(`Vídeo de revisión: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
    console.log(`Audio (16 kHz mono): ${audioOut} (${(fs.statSync(audioOut).size / 1e6).toFixed(1)} MB)`);
  } else if (cmd === 'proxy') {
    const pending = pendingProxies(dir, p);
    if (!pending.length) console.log('Todas las copias ligeras están listas.');
    for (const src of pending) {
      let shown = -1;
      await makeProxy(dir, p, src, {
        onProgress: (v) => {
          const pc = Math.floor(v * 10) * 10;
          if (pc !== shown) console.log(`${src}: ${(shown = pc)}%`);
        },
      });
      console.log(`Copia ligera lista: ${src}`);
    }
  } else if (cmd === 'frame') {
    const out = path.resolve(arg('out') || path.join(dir, '.editor', 'frame.png'));
    await exportFrame({ dir, project: p, t: parseTime(arg('time') || args[1] || '0'), out, renderHtmlFrame });
    console.log(`Fotograma: ${out}`);
  } else {
    throw new Error(`Comando desconocido: ${cmd}`);
  }
}

// ---------- Arranque ----------

// La CLI y las capturas usan su propia carpeta de datos: así no chocan con la app abierta
// ni cambian la lista de proyectos recientes.
if (cliMode || process.env.EDITOR_SNAPSHOT) app.setPath('userData', path.join(os.tmpdir(), 'editor-aux'));
if (cliMode) app.disableHardwareAcceleration();

// Una sola ventana: si ya está abierta, la segunda vez solo se trae al frente.
const gotLock = cliMode || process.env.EDITOR_SNAPSHOT ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  media = await startMediaServer();
  if (cliMode) {
    try {
      await runCli();
      app.exit(0);
    } catch (e) {
      console.error(e.message);
      app.exit(1);
    }
    return;
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (!cliMode) app.quit();
});
