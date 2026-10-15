import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clip, Project, Range, Track } from '../core/project.mjs';
import * as P from '../core/project.mjs';
import { api, type ExportProgress, type SilenceOptions } from './api';
import { clock, usePlaying, useTime } from './clock';
import { useHistory } from './history';
import { Preview } from './Preview';
import { Timeline, HEAD_W, type DropRequest } from './Timeline';
import { Inspector, MediaBin } from './Panels';

export function Editor({ dir, initial, base, onClose }: { dir: string; initial: Project; base: string; onClose(): void }) {
  const h = useHistory(initial);
  const project = h.project;
  const [selection, setSelection] = useState<string[]>([]);
  const [pps, setPps] = useState(40);
  const [silences, setSilences] = useState<{ clipId: string; ranges: Range[] } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<{ message: string; log: string } | null>(null);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const [proxyProgress, setProxyProgress] = useState<{ src: string; value: number } | null>(null);
  const [useProxies, setUseProxies] = useState(true);
  const [peaks, setPeaks] = useState<Record<string, Uint8Array>>({});
  const [toast, setToast] = useState<string | null>(null);
  const timelineBox = useRef<HTMLDivElement>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as any).t);
    (notify as any).t = window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Aplica una operación del núcleo y la guarda en el historial; los errores se muestran como aviso
  const apply = useCallback(
    (fn: (p: Project) => Project) => {
      try {
        h.commit(fn(h.current()));
      } catch (e: any) {
        notify(e.message);
      }
    },
    [h.commit, h.current, notify],
  );

  // ---------- sincronización con disco ----------
  const lastSaved = useRef(initial);
  useEffect(() => {
    if (h.saved === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = h.saved;
      api.saveProject(h.saved);
    }, 250);
    return () => clearTimeout(t);
  }, [h.saved]);

  useEffect(() => {
    const offExt = api.onExternalChange((p) => {
      lastSaved.current = p;
      h.commit(p); // entra en el historial: los cambios de Claude se pueden deshacer
      setSelection((sel) => sel.filter((id) => P.findClip(p, id)));
    });
    const offErr = api.onError(notify);
    const offProg = api.onExportProgress((pr) => setExporting((cur) => (cur ? pr : cur)));
    const offProxyProg = api.onProxyProgress(setProxyProgress);
    const offProxyReady = api.onProxyReady(setProxies);
    const offWave = api.onWaveforms(setPeaks);
    api.proxies(h.current()).then(setProxies);
    api.waveforms(h.current()).then(setPeaks);
    return () => {
      offWave();
      offProxyProg();
      offProxyReady();
      offExt();
      offErr();
      offProg();
    };
  }, [h.commit, notify]);

  // Zoom inicial: que quepa todo el proyecto
  useEffect(() => {
    const total = P.totalDuration(initial);
    const w = (timelineBox.current?.clientWidth || 1200) - HEAD_W - 40;
    if (total > 0) setPps(Math.max(2, Math.min(200, w / total)));
  }, []);

  // ---------- reproducción ----------
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (!clock.playing) return;
      if (last) {
        const total = P.totalDuration(h.current());
        const t = clock.time + (now - last) / 1000;
        if (t >= total) {
          clock.seek(total);
          clock.setPlaying(false);
          return;
        }
        clock.seek(t);
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    const unsub = clock.subscribe(() => {
      if (clock.playing && !raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
      if (!clock.playing) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [h.current]);

  const togglePlay = useCallback(() => {
    const total = P.totalDuration(h.current());
    if (!clock.playing && clock.time >= total - 0.01) clock.seek(0);
    clock.setPlaying(!clock.playing);
  }, [h.current]);

  // ---------- acciones ----------
  const split = useCallback(() => {
    const t = clock.time;
    apply((p) => {
      // si hay clips seleccionados bajo la cabeza lectora, solo esos; si no, todos
      const sel = selection.map((id) => P.findClip(p, id)).filter((f) => f && t > f.clip.start && t < P.clipEnd(f.clip));
      if (sel.length) return sel.reduce((acc, f) => P.splitClip(acc, f!.clip.id, t).project, p);
      return P.splitAt(p, t);
    });
  }, [apply, selection]);

  const remove = useCallback(
    (ripple: boolean) => {
      if (!selection.length) return;
      apply((p) => P.deleteClips(p, selection, { ripple }));
      setSelection([]);
    },
    [apply, selection],
  );

  const importFiles = useCallback(
    async (paths?: string[]) => {
      const assets = await api.importMedia(paths);
      if (Object.keys(assets).length) apply((p) => ({ ...p, assets: { ...p.assets, ...assets } }));
      return assets;
    },
    [apply],
  );

  const addAt = useCallback(
    (srcs: string[], time: number, trackId: string | null, extraAssets: Record<string, any> = {}) => {
      apply((p0) => {
        let p = { ...p0, assets: { ...p0.assets, ...extraAssets } };
        let t = time;
        const added: string[] = [];
        for (const src of srcs) {
          const kind = P.kindOf(src);
          if (!kind) continue;
          let target = trackId && P.findTrack(p, trackId)?.kind === P.trackKindFor(kind) ? trackId : undefined;
          if (!target) target = p.tracks.find((tr) => tr.kind === P.trackKindFor(kind))?.id;
          const r = P.addClip(p, { src, trackId: target, start: t });
          p = r.project;
          added.push(r.clipId);
          t = P.clipEnd(P.findClip(p, r.clipId)!.clip);
        }
        setSelection(added);
        return p;
      });
    },
    [apply],
  );

  const onDrop = useCallback(
    async (r: DropRequest) => {
      if (r.src) addAt([r.src], r.time, r.trackId);
      else if (r.files) {
        const assets = await api.importMedia(r.files.map((f) => api.pathForFile(f)));
        addAt(Object.keys(assets), r.time, r.trackId, assets);
      }
    },
    [addAt],
  );

  const detectSilences = useCallback(
    async (clipId: string, opts: SilenceOptions) => {
      setDetecting(true);
      try {
        const { ranges, noise } = await api.detectSilences({ project: h.current(), clipId, opts });
        setSilences({ clipId, ranges });
        if (opts.noise === 'auto') notify(`Umbral calculado con el ruido de fondo: ${noise} dB`);
      } catch (e: any) {
        notify(e.message);
      } finally {
        setDetecting(false);
      }
    },
    [h.current, notify],
  );

  const applySilences = useCallback(() => {
    if (!silences) return;
    const removed = silences.ranges.reduce((s, r) => s + r.end - r.start, 0);
    apply((p) => P.removeRanges(p, silences.clipId, silences.ranges));
    notify(`Quitados ${silences.ranges.length} silencios (${removed.toFixed(1)} s)`);
    setSilences(null);
    setSelection([]);
  }, [apply, silences, notify]);

  const doExport = useCallback(
    async (preset: 'final' | 'draft' = 'final') => {
      if (exporting) return;
      clock.setPlaying(false);
      setExportError(null);
      setExporting({ phase: 'inicio', label: 'Preparando…', value: 0 });
      try {
        const out = await api.exportVideo(h.current(), preset);
        if (out) {
          notify(preset === 'draft' ? 'Borrador exportado' : 'Vídeo exportado');
          api.reveal(out);
        }
      } catch (e: any) {
        // el proceso principal manda "mensaje||ruta del registro"; el error se queda a la vista
        const raw = String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        const [message, log] = raw.split('||');
        setExportError({ message, log: log || '' });
      } finally {
        setExporting(null);
      }
    },
    [exporting, h.current, notify],
  );

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const p = h.current();
      const frame = 1 / p.fps;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'z' && !e.shiftKey) h.undo();
      else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) h.redo();
      else if (e.ctrlKey && k === 'e') doExport('final');
      else if (e.ctrlKey && k === 'i') importFiles();
      else if (e.ctrlKey && k === 'a') setSelection(P.allClips(p).map((c) => c.id));
      else if (e.ctrlKey && k === 'b') split();
      else if (e.ctrlKey) return;
      else if (e.code === 'Space') togglePlay();
      else if (k === 's') split();
      else if (k === 'delete' || k === 'backspace') remove(e.shiftKey);
      else if (k === 'arrowleft') clock.seek(P.snapToFrame(p, clock.time - (e.shiftKey ? 1 : frame)));
      else if (k === 'arrowright') clock.seek(P.snapToFrame(p, clock.time + (e.shiftKey ? 1 : frame)));
      else if (k === 'home') clock.seek(0);
      else if (k === 'end') clock.seek(P.totalDuration(p));
      else if (k === '+' || k === '=') setPps((v) => Math.min(600, v * 1.25));
      else if (k === '-') setPps((v) => Math.max(2, v / 1.25));
      else if (k === 'escape') setSelection([]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h.undo, h.redo, h.current, doExport, importFiles, split, remove, togglePlay]);

  return (
    <div className="editor">
      <header className="topbar">
        <button className="ghost" onClick={onClose} title="Cerrar proyecto">
          ☰
        </button>
        <div className="project-name">
          {project.name}
          <span className="muted">
            {project.width}×{project.height} · {project.fps} fps · {dir}
          </span>
        </div>
        <div className="spacer" />
        <button onClick={h.undo} disabled={!h.canUndo} title="Deshacer (Ctrl+Z)">
          ↶
        </button>
        <button onClick={h.redo} disabled={!h.canRedo} title="Rehacer (Ctrl+Y)">
          ↷
        </button>
        <button onClick={() => importFiles()}>Importar</button>
        <button onClick={() => doExport('draft')} disabled={!!exporting} title="Exporta rápido a 480p para revisar el montaje entero">
          Borrador rápido
        </button>
        <button className="primary" onClick={() => doExport('final')} disabled={!!exporting}>
          Exportar
        </button>
      </header>

      <div className="main-area">
        <MediaBin project={project} onImport={() => importFiles()} onAdd={(src) => addAt([src], clock.time, null)} />
        <div className="center">
          <Preview project={project} dir={dir} base={base} proxies={useProxies ? proxies : {}} peaks={peaks} />
          <Transport project={project} onToggle={togglePlay}>
            <button
              className={`ghost quality ${useProxies ? 'on' : ''}`}
              onClick={() => setUseProxies((v) => !v)}
              title={useProxies ? 'La preview usa copias ligeras (fluida). Clic para ver el original.' : 'La preview usa el original. Clic para usar copias ligeras.'}
            >
              {useProxies ? 'Preview ligera' : 'Preview original'}
            </button>
            {proxyProgress && <span className="muted proxy-status">Preparando copia ligera {Math.round(proxyProgress.value * 100)} %</span>}
          </Transport>
        </div>
        <Inspector
          project={project}
          selection={selection}
          update={(id, patch: Partial<Clip>) => apply((p) => P.updateClip(p, id, patch))}
          updateProject={(patch) => apply((p) => ({ ...p, ...patch }))}
          silences={silences}
          detecting={detecting}
          detectSilences={detectSilences}
          applySilences={applySilences}
          discardSilences={() => setSilences(null)}
        />
      </div>

      <div className="timeline" ref={timelineBox}>
        <div className="timeline-tools">
          <button onClick={split} title="Cortar en la cabeza lectora (S)">
            ✂ Cortar
          </button>
          <button onClick={() => remove(false)} disabled={!selection.length} title="Borrar (Supr)">
            Borrar
          </button>
          <button onClick={() => remove(true)} disabled={!selection.length} title="Borrar y cerrar el hueco (Mayús+Supr)">
            Borrar y cerrar hueco
          </button>
          <div className="spacer" />
          <span className="muted">Zoom</span>
          <input type="range" min={Math.log(2)} max={Math.log(600)} step={0.01} value={Math.log(pps)} onChange={(e) => setPps(Math.exp(Number(e.target.value)))} />
        </div>
        <Timeline
          project={project}
          committed={h.saved}
          selection={selection}
          onSelect={setSelection}
          preview={h.preview}
          commit={h.commit}
          pps={pps}
          setPps={setPps}
          silences={silences}
          peaks={peaks}
          onDrop={onDrop}
          onTrackChange={(id, patch: Partial<Track>) => apply((p) => P.updateTrack(p, id, patch))}
          onTrackRemove={(id) => apply((p) => P.removeTrack(p, id))}
          onAddTrack={(kind) => apply((p) => P.addTrack(p, kind).project)}
        />
      </div>

      {exporting && (
        <div className="modal-back">
          <div className="modal">
            <div className="subtitle">Exportando</div>
            <p>{exporting.label}</p>
            <div className="progress">
              <div style={{ width: `${Math.round(exporting.value * 100)}%` }} />
            </div>
            <button onClick={() => api.cancelExport()}>Cancelar</button>
          </div>
        </div>
      )}
      {exportError && (
        <div className="modal-back">
          <div className="modal">
            <div className="subtitle error">La exportación ha fallado</div>
            <p className="error-text">{exportError.message}</p>
            {exportError.log && <p className="muted small">Registro completo: {exportError.log}</p>}
            <div className="modal-buttons">
              {exportError.log && <button onClick={() => api.reveal(exportError.log)}>Ver registro</button>}
              <button className="primary" onClick={() => setExportError(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Transport({ project, onToggle, children }: { project: Project; onToggle(): void; children?: React.ReactNode }) {
  const t = useTime();
  const playing = usePlaying();
  return (
    <div className="transport">
      <button className="ghost" onClick={() => clock.seek(0)} title="Inicio">
        ⏮
      </button>
      <button className="play" onClick={onToggle} title="Reproducir (Espacio)">
        {playing ? '⏸' : '▶'}
      </button>
      <span className="timecode">
        {P.formatTime(t, project.fps)} <span className="muted">/ {P.formatTime(P.totalDuration(project), project.fps)}</span>
      </span>
      {children}
    </div>
  );
}
