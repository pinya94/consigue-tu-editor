// Proceso principal de Electron: ventana, diálogos, disco, vigilancia del proyecto y exportación.
// También tiene un modo sin ventana (--cli) que usa la CLI para exportar y sacar fotogramas.
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMediaServer } from './server.mjs';
import { makeHtmlRenderer } from './htmlRender.mjs';
import { loadProject, saveProject, initProject, syncAssets, toSrc, probe, clipSilences, projectFile, findProjectDir, serialize, writeProjectGuide } from '../core/media.mjs';
import { exportProject, exportFrame } from '../core/export.mjs';
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
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return { recent: [] };
  }
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
  win?.setTitle(`${p.name} — CupCut`);
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
      } catch (e) {
        // JSON a medio escribir o con errores: se avisa y se espera al siguiente cambio
        send('app:error', `No se pudo leer ${PROJECT_FILE}: ${e.message}`);
      }
    }, 200);
  });
}

// ---------- Ventana ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#15161a',
    title: 'CupCut',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F5') win.webContents.reload();
  });
  if (process.env.CUPCUT_DEV_URL) win.loadURL(process.env.CUPCUT_DEV_URL);
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));

  // Para revisar la interfaz sin mirar la pantalla: CUPCUT_SNAPSHOT=captura.png electron . --project <dir>
  // Opcionalmente CUPCUT_SNAPSHOT_JS ejecuta código en la interfaz antes de la captura.
  if (process.env.CUPCUT_SNAPSHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.CUPCUT_SNAPSHOT_JS) {
        await win.webContents.executeJavaScript(process.env.CUPCUT_SNAPSHOT_JS).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, 1500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(process.env.CUPCUT_SNAPSHOT), img.toPNG());
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

  ipcMain.handle('export:run', async (_e, project) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar vídeo',
      defaultPath: path.join(current.dir, 'export', `${project.name}.mp4`),
      filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
    });
    if (r.canceled) return null;
    exportAbort = new AbortController();
    const { renderHtml } = makeHtmlRenderer({ dir: current.dir, project, urlFor: media.urlFor });
    try {
      await exportProject({ dir: current.dir, project, out: r.filePath, renderHtml, signal: exportAbort.signal, onProgress: (pr) => send('export:progress', pr) });
    } finally {
      exportAbort = null;
    }
    return r.filePath;
  });
  ipcMain.handle('export:cancel', () => exportAbort?.abort());

  ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
}

// ---------- Modo CLI (sin ventana) ----------
// CupCut.exe --cli <comando> ...   (en desarrollo: electron . --cli <comando> ...)
// export y frame necesitan Chromium para las animaciones y se resuelven aquí; el resto lo hace cli/cupcut.mjs.

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runCli() {
  const args = process.argv.slice(process.argv.indexOf('--cli') + 1);
  const cmd = args[0];
  if (cmd !== 'export' && cmd !== 'frame') {
    const { run } = await import('../cli/cupcut.mjs');
    await run(args);
    return;
  }
  const dir = arg('project') ? path.resolve(arg('project')) : findProjectDir();
  if (!dir) throw new Error('No hay proyecto.json aquí. Usa --project <carpeta>.');
  let p = loadProject(dir);
  p = (await syncAssets(dir, p)).project;
  const { renderHtml, renderHtmlFrame } = makeHtmlRenderer({ dir, project: p, urlFor: media.urlFor });
  if (cmd === 'export') {
    const out = path.resolve(arg('out') || path.join(dir, 'export', `${p.name}.mp4`));
    let last = '';
    await exportProject({
      dir, project: p, out, renderHtml,
      onProgress: (pr) => {
        const line = `${pr.label}: ${Math.round(pr.value * 100)}%`;
        if (line !== last && Math.round(pr.value * 100) % 10 === 0) console.log(line);
        last = line;
      },
    });
    console.log(`Exportado: ${out}`);
  } else if (cmd === 'frame') {
    const out = path.resolve(arg('out') || path.join(dir, '.cupcut', 'frame.png'));
    await exportFrame({ dir, project: p, t: parseTime(arg('time') || args[1] || '0'), out, renderHtmlFrame });
    console.log(`Fotograma: ${out}`);
  } else {
    throw new Error(`Comando desconocido: ${cmd}`);
  }
}

// ---------- Arranque ----------

// La CLI y las capturas usan su propia carpeta de datos: así no chocan con la app abierta
// ni cambian la lista de proyectos recientes.
if (cliMode || process.env.CUPCUT_SNAPSHOT) app.setPath('userData', path.join(os.tmpdir(), 'cupcut-aux'));
if (cliMode) app.disableHardwareAcceleration();

app.whenReady().then(async () => {
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
