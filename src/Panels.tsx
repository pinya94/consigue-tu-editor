import { useState } from 'react';
import type { Asset, Clip, Fit, Project, Range } from '../core/project.mjs';
import { findClip, formatTime, kindOf } from '../core/project.mjs';
import { fileName } from './api';

const KIND_ICON: Record<string, string> = { video: '🎬', audio: '🎵', image: '🖼', html: '✨' };
const KIND_NAME: Record<string, string> = { video: 'Vídeo', audio: 'Audio', image: 'Imagen', html: 'Animación' };

// ---------- Biblioteca de medios ----------

export function MediaBin({ project, onImport, onAdd }: { project: Project; onImport(): void; onAdd(src: string): void }) {
  const entries = Object.entries(project.assets).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="panel bin">
      <div className="panel-title">
        Medios
        <button onClick={onImport}>Importar…</button>
      </div>
      <div className="bin-list">
        {entries.length === 0 && <p className="hint">Importa archivos o arrástralos al timeline. Lo que guardes en la carpeta media/ aparece aquí solo.</p>}
        {entries.map(([src, a]) => (
          <BinItem key={src} src={src} asset={a} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}

function BinItem({ src, asset, onAdd }: { src: string; asset: Asset; onAdd(src: string): void }) {
  return (
    <div
      className={`bin-item ${asset.missing ? 'missing' : ''}`}
      draggable={!asset.missing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-cupcut-src', src);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => !asset.missing && onAdd(src)}
      title={`${src}\nDoble clic: añadir en la cabeza lectora`}
    >
      <span className="bin-icon">{KIND_ICON[asset.kind] || '?'}</span>
      <span className="bin-name">{fileName(src)}</span>
      <span className="bin-meta">{asset.missing ? 'no encontrado' : asset.duration != null ? formatTime(asset.duration) : KIND_NAME[asset.kind]}</span>
    </div>
  );
}

// ---------- Inspector ----------

interface InspectorProps {
  project: Project;
  selection: string[];
  update(clipId: string, patch: Partial<Clip>): void;
  updateProject(patch: Partial<Project>): void;
  silences: { clipId: string; ranges: Range[] } | null;
  detecting: boolean;
  detectSilences(clipId: string, opts: { noise: number; minDuration: number; pad: number }): void;
  applySilences(): void;
  discardSilences(): void;
}

export function Inspector(props: InspectorProps) {
  const { project, selection } = props;
  if (selection.length === 1) {
    const f = findClip(project, selection[0]);
    if (f) return <ClipInspector {...props} clip={f.clip} trackName={f.track.name} />;
  }
  return (
    <div className="panel inspector">
      <div className="panel-title">{selection.length > 1 ? `${selection.length} clips seleccionados` : 'Proyecto'}</div>
      {selection.length <= 1 && (
        <div className="fields">
          <Field label="Nombre" value={project.name} onCommit={(v) => props.updateProject({ name: v })} text />
          <Field label="Ancho" value={project.width} onCommit={(v) => props.updateProject({ width: Math.round(Number(v)) })} />
          <Field label="Alto" value={project.height} onCommit={(v) => props.updateProject({ height: Math.round(Number(v)) })} />
          <Field label="FPS" value={project.fps} onCommit={(v) => props.updateProject({ fps: Number(v) })} />
        </div>
      )}
      <Shortcuts />
    </div>
  );
}

function ClipInspector(props: InspectorProps & { clip: Clip; trackName: string }) {
  const { clip, project } = props;
  const kind = kindOf(clip.src);
  const asset = project.assets[clip.src];
  const [noise, setNoise] = useState(-35);
  const [minDuration, setMinDuration] = useState(0.5);
  const [pad, setPad] = useState(0.12);
  const sil = props.silences && props.silences.clipId === clip.id ? props.silences.ranges : null;
  const silTotal = sil ? sil.reduce((s, r) => s + r.end - r.start, 0) : 0;
  const num = (v: string) => Number(v.replace(',', '.'));

  return (
    <div className="panel inspector">
      <div className="panel-title">
        {KIND_ICON[kind || 'video']} {clip.id}
        <span className="muted">{props.trackName}</span>
      </div>
      <div className="src" title={clip.src}>
        {clip.src}
      </div>
      <div className="fields">
        <Field label="Inicio (s)" value={clip.start} onCommit={(v) => props.update(clip.id, { start: num(v) })} />
        <Field label="Duración (s)" value={clip.duration} onCommit={(v) => props.update(clip.id, { duration: num(v) })} />
        <Field label="Desde (s)" hint="Segundo del archivo original donde empieza el clip" value={clip.in} onCommit={(v) => props.update(clip.id, { in: num(v) })} />
        {(kind === 'video' || kind === 'audio') && <Field label="Volumen" hint="1 = original, 0 = silencio, 2 = doble" value={clip.volume ?? 1} onCommit={(v) => props.update(clip.id, { volume: num(v) })} />}
        {kind !== 'audio' && (
          <>
            <Field label="Zoom" hint="1 = normal, 1.2 = 20 % más cerca" value={clip.zoom ?? 1} onCommit={(v) => props.update(clip.id, { zoom: Math.max(1, Math.min(5, num(v))) })} />
            <Field label="Enfoque X" hint="Hacia dónde se acerca el zoom: 0 = izquierda, 0.5 = centro, 1 = derecha" value={clip.zoomX ?? 0.5} onCommit={(v) => props.update(clip.id, { zoomX: Math.max(0, Math.min(1, num(v))) })} />
            <Field label="Enfoque Y" hint="0 = arriba, 0.5 = centro, 1 = abajo" value={clip.zoomY ?? 0.5} onCommit={(v) => props.update(clip.id, { zoomY: Math.max(0, Math.min(1, num(v))) })} />
          </>
        )}
        {kind !== 'audio' && (
          <label className="field">
            <span>Encaje</span>
            <select value={clip.fit || 'contain'} onChange={(e) => props.update(clip.id, { fit: e.target.value as Fit })}>
              <option value="contain">Completo (bandas)</option>
              <option value="cover">Rellenar (recorta)</option>
              <option value="stretch">Estirar</option>
            </select>
          </label>
        )}
      </div>
      {asset && (
        <div className="asset-info">
          {asset.width ? `${asset.width}×${asset.height} · ` : ''}
          {asset.duration != null ? `original ${formatTime(asset.duration)}` : 'duración libre'}
          {asset.hasAudio === false && kind === 'video' ? ' · sin audio' : ''}
        </div>
      )}

      {asset?.hasAudio && (
        <div className="silences-box">
          <div className="subtitle">Silencios</div>
          <div className="fields compact">
            <Field label="Umbral (dB)" hint="Más alto (p. ej. -30) detecta más silencios" value={noise} onCommit={(v) => setNoise(num(v))} />
            <Field label="Mínimo (s)" hint="Duración mínima de un silencio" value={minDuration} onCommit={(v) => setMinDuration(num(v))} />
            <Field label="Margen (s)" hint="Se deja este margen a cada lado para no cortar palabras" value={pad} onCommit={(v) => setPad(num(v))} />
          </div>
          <button className="primary wide" disabled={props.detecting} onClick={() => props.detectSilences(clip.id, { noise, minDuration, pad })}>
            {props.detecting ? 'Analizando…' : 'Detectar silencios'}
          </button>
          {sil && (
            <div className="silence-result">
              {sil.length === 0 ? (
                <p>No se han encontrado silencios con estos ajustes.</p>
              ) : (
                <>
                  <p>
                    {sil.length} silencios · {silTotal.toFixed(1)} s en total (marcados en rojo en el timeline)
                  </p>
                  <button className="primary wide" onClick={props.applySilences}>
                    Quitar silencios
                  </button>
                </>
              )}
              <button className="wide" onClick={props.discardSilences}>
                Descartar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCommit, text, hint }: { label: string; value: string | number; onCommit(v: string): void; text?: boolean; hint?: string }) {
  const shown = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : value;
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      <input
        key={shown}
        defaultValue={shown}
        inputMode={text ? 'text' : 'decimal'}
        onBlur={(e) => e.target.value !== shown && onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).value = shown;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function Shortcuts() {
  const rows = [
    ['Espacio', 'Reproducir / pausa'],
    ['S', 'Cortar en la cabeza lectora'],
    ['Supr', 'Borrar clip'],
    ['Mayús+Supr', 'Borrar y cerrar hueco'],
    ['← →', 'Fotograma anterior / siguiente'],
    ['Mayús+← →', '1 segundo'],
    ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
    ['Ctrl+rueda, + −', 'Zoom'],
    ['Alt al arrastrar', 'Sin imán'],
    ['Ctrl+E', 'Exportar'],
  ];
  return (
    <div className="shortcuts">
      <div className="subtitle">Atajos</div>
      {rows.map(([k, v]) => (
        <div key={k}>
          <kbd>{k}</kbd> {v}
        </div>
      ))}
    </div>
  );
}
