import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Clip, Project, Range, Track } from '../core/project.mjs';
import { clipEnd, formatTime, kindOf, moveClip, snapToFrame, trimClip, totalDuration } from '../core/project.mjs';
import { clock, useTime } from './clock';
import { fileName } from './api';

export const HEAD_W = 168;
const RULER_H = 28;
const SNAP_PX = 8;

export interface DropRequest {
  trackId: string | null;
  time: number;
  src?: string;
  files?: File[];
}

interface Props {
  project: Project;
  committed: Project;
  selection: string[];
  onSelect(ids: string[]): void;
  preview(p: Project | null): void;
  commit(p: Project): void;
  pps: number;
  setPps(v: number): void;
  silences: { clipId: string; ranges: Range[] } | null;
  onDrop(r: DropRequest): void;
  onTrackChange(trackId: string, patch: Partial<Track>): void;
  onTrackRemove(trackId: string): void;
  onAddTrack(kind: 'video' | 'audio'): void;
}

// Orden en pantalla: las pistas de vídeo de arriba (las que se pintan encima) primero, luego el audio.
function displayTracks(p: Project) {
  const video = p.tracks.filter((t) => t.kind === 'video').reverse();
  const audio = p.tracks.filter((t) => t.kind === 'audio');
  return [...video, ...audio];
}

function tickStep(pps: number) {
  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * pps >= 90) || 600;
}

export function Timeline(props: Props) {
  const { project, pps } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const total = totalDuration(project);
  const contentW = Math.max(view.width, (total + 30) * pps + HEAD_W);
  const tracks = displayTracks(project);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl + rueda = zoom centrado en el ratón
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - HEAD_W;
      const t = (el.scrollLeft + x) / props.pps;
      const next = Math.max(2, Math.min(600, props.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      props.setPps(next);
      requestAnimationFrame(() => (el.scrollLeft = t * next - x));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [props.pps, props.setPps]);

  // La cabeza lectora no se sale de la vista durante la reproducción
  useEffect(
    () =>
      clock.subscribe(() => {
        const el = scrollRef.current;
        if (!el || !clock.playing) return;
        const x = clock.time * pps;
        const visibleW = el.clientWidth - HEAD_W;
        if (x > el.scrollLeft + visibleW - 40 || x < el.scrollLeft) el.scrollLeft = x - 40;
      }),
    [pps],
  );

  const timeFromClientX = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEAD_W + el.scrollLeft) / pps);
  };

  // Arrastrar en la regla o en una zona vacía = mover la cabeza lectora
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    props.onSelect([]);
    clock.setPlaying(false);
    clock.seek(timeFromClientX(e.clientX));
    const move = (ev: PointerEvent) => clock.seek(timeFromClientX(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- arrastrar clips ----------
  const startDrag = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'left' | 'right') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const base = props.committed;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let draft: Project | null = null;
    const sel = e.shiftKey || e.ctrlKey ? Array.from(new Set([...props.selection, clip.id])) : props.selection.includes(clip.id) ? props.selection : [clip.id];
    props.onSelect(sel);

    // puntos a los que se "pega" el clip: inicio, cabeza lectora y bordes de otros clips
    const snaps = [0, clock.time];
    for (const t of base.tracks) for (const c of t.clips) if (c.id !== clip.id) snaps.push(c.start, clipEnd(c));
    const snap = (t: number, alt: boolean) => {
      // sin imán, al menos se ajusta a fotogramas exactos
      const ft = snapToFrame(base, t);
      if (alt) return { t: ft, d: Infinity };
      let best = { t: ft, d: SNAP_PX / pps };
      for (const s of snaps) if (Math.abs(s - t) < best.d) best = { t: s, d: Math.abs(s - t) };
      return best;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      // pequeña zona muerta para que un clic no mueva el clip
      if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      const dt = dx / pps;
      try {
        if (mode === 'move') {
          const a = snap(clip.start + dt, ev.altKey);
          const b = snap(clipEnd(clip) + dt, ev.altKey);
          const start = a.d <= b.d ? a.t : b.t - clip.duration;
          const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-track]') as HTMLElement | null;
          const target = lane?.dataset.track;
          const kindOk = target && base.tracks.find((t) => t.id === target)?.kind === base.tracks.find((t) => t.clips.some((c) => c.id === clip.id))?.kind;
          draft = moveClip(base, clip.id, start, kindOk ? target : undefined);
        } else if (mode === 'left') {
          draft = trimClip(base, clip.id, { start: snap(clip.start + dt, ev.altKey).t });
        } else {
          draft = trimClip(base, clip.id, { end: snap(clipEnd(clip) + dt, ev.altKey).t });
        }
        props.preview(draft);
      } catch {
        // movimiento no válido (p. ej. vídeo a pista de audio): se ignora
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved && draft) props.commit(draft);
      else props.preview(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- soltar archivos / elementos de la biblioteca ----------
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const lane = (e.target as HTMLElement).closest('[data-track]') as HTMLElement | null;
    const src = e.dataTransfer.getData('application/x-editor-src');
    const files = Array.from(e.dataTransfer.files);
    props.onDrop({ trackId: lane?.dataset.track || null, time: timeFromClientX(e.clientX), src: src || undefined, files: files.length ? files : undefined });
  };

  const selected = useMemo(() => new Set(props.selection), [props.selection]);

  return (
    <div
      className="timeline-scroll"
      ref={scrollRef}
      onScroll={(e) => setView({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="timeline-content" style={{ width: contentW }}>
        <div className="ruler-row" style={{ height: RULER_H }}>
          <div className="corner" style={{ width: HEAD_W }}>
            <button title="Añadir pista de vídeo" onClick={() => props.onAddTrack('video')}>+ Vídeo</button>
            <button title="Añadir pista de audio" onClick={() => props.onAddTrack('audio')}>+ Audio</button>
          </div>
          <Ruler pps={pps} left={view.left} width={view.width} fps={project.fps} onPointerDown={scrub} />
        </div>
        {tracks.map((track) => (
          <div key={track.id} className={`track-row ${track.kind}`}>
            <TrackHead track={track} onChange={props.onTrackChange} onRemove={props.onTrackRemove} canRemove={project.tracks.length > 1} />
            <div className={`lane ${track.hidden || track.muted ? 'off' : ''}`} data-track={track.id} onPointerDown={scrub}>
              {track.clips.map((c) => (
                <ClipView key={c.id} clip={c} pps={pps} selected={selected.has(c.id)} missing={!!project.assets[c.src]?.missing} onDrag={startDrag} />
              ))}
              {props.silences &&
                track.clips.some((c) => c.id === props.silences!.clipId) &&
                props.silences.ranges.map((r, i) => (
                  <div key={i} className="silence" style={{ left: r.start * pps, width: (r.end - r.start) * pps }} title={`Silencio ${(r.end - r.start).toFixed(2)}s`} />
                ))}
            </div>
          </div>
        ))}
        <div className="lane-filler" onPointerDown={scrub} />
        <Playhead pps={pps} />
      </div>
    </div>
  );
}

function Ruler({ pps, left, width, fps, onPointerDown }: { pps: number; left: number; width: number; fps: number; onPointerDown(e: React.PointerEvent): void }) {
  const step = tickStep(pps);
  const from = Math.floor(left / pps / step) * step;
  const to = (left + width) / pps;
  const ticks = [];
  for (let t = from, i = 0; t <= to && i < 2000; t += step, i++) {
    const tt = Math.round(t * 1000) / 1000;
    ticks.push(
      <div key={tt} className="tick" style={{ left: tt * pps }}>
        <span>{step < 1 ? formatTime(tt, fps) : formatTime(tt).slice(0, 5)}</span>
      </div>,
    );
  }
  return (
    <div className="ruler" onPointerDown={onPointerDown}>
      {ticks}
    </div>
  );
}

function Playhead({ pps }: { pps: number }) {
  const t = useTime();
  return <div className="playhead" style={{ left: HEAD_W + t * pps }} />;
}

function TrackHead({ track, onChange, onRemove, canRemove }: { track: Track; onChange: Props['onTrackChange']; onRemove: Props['onTrackRemove']; canRemove: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="track-head" style={{ width: HEAD_W }}>
      <span className="track-id">{track.id}</span>
      {editing ? (
        <input
          autoFocus
          defaultValue={track.name}
          onBlur={(e) => {
            onChange(track.id, { name: e.target.value || track.name });
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span className="track-name" onDoubleClick={() => setEditing(true)} title="Doble clic para renombrar">
          {track.name}
        </span>
      )}
      <span className="track-buttons">
        {track.kind === 'video' ? (
          <button className={track.hidden ? 'on' : ''} title={track.hidden ? 'Mostrar pista' : 'Ocultar pista'} onClick={() => onChange(track.id, { hidden: !track.hidden })}>
            {track.hidden ? '◌' : '◉'}
          </button>
        ) : null}
        <button className={track.muted ? 'on' : ''} title={track.muted ? 'Activar sonido' : 'Silenciar pista'} onClick={() => onChange(track.id, { muted: !track.muted })}>
          {track.muted ? '🔇' : '🔊'}
        </button>
        {canRemove && (
          <button title="Eliminar pista" onClick={() => onRemove(track.id)}>
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

const ClipView = memo(function ClipView({
  clip,
  pps,
  selected,
  missing,
  onDrag,
}: {
  clip: Clip;
  pps: number;
  selected: boolean;
  missing: boolean;
  onDrag(e: React.PointerEvent, c: Clip, mode: 'move' | 'left' | 'right'): void;
}) {
  const kind = kindOf(clip.src) || 'video';
  const w = clip.duration * pps;
  return (
    <div
      className={`clip ${kind} ${selected ? 'selected' : ''} ${missing ? 'missing' : ''}`}
      style={{ left: clip.start * pps, width: Math.max(2, w) }}
      onPointerDown={(e) => onDrag(e, clip, 'move')}
      title={`${clip.id} · ${clip.src}\n${formatTime(clip.start)} → ${formatTime(clipEnd(clip))} (${clip.duration.toFixed(2)}s)`}
    >
      {w > 30 && (
        <span className="clip-label">
          <b>{clip.id}</b> {fileName(clip.src)}
        </span>
      )}
      <div className="handle left" onPointerDown={(e) => onDrag(e, clip, 'left')} />
      <div className="handle right" onPointerDown={(e) => onDrag(e, clip, 'right')} />
    </div>
  );
});
