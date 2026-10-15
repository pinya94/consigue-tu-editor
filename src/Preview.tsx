import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Clip, Fit, Project, Track } from '../core/project.mjs';
import { clipEnd, kindOf, zoomAt } from '../core/project.mjs';
import { duckEnvelope, duckLevel, envelopeAt, hasDucking, voiceActivity } from '../core/duck.mjs';
import { mediaUrl } from './api';
import { useTime, usePlaying } from './clock';

const PRELOAD_AHEAD = 3; // segundos: se carga por adelantado el siguiente clip de cada pista

// Mismo cálculo que en la exportación: escalar alrededor del punto de enfoque.
// `since`: segundos desde el inicio del clip (para el zoom animado).
function zoomStyle(c: Clip, since: number): React.CSSProperties {
  const z = zoomAt(c, since);
  if (z === 1) return {};
  return { transform: `scale(${z})`, transformOrigin: `${(c.zoomX ?? 0.5) * 100}% ${(c.zoomY ?? 0.5) * 100}%` };
}

const objectFit = (fit?: Fit) => (fit === 'cover' ? 'cover' : fit === 'stretch' ? 'fill' : 'contain');

interface LayerInfo {
  key: string;
  track: Track;
  clip: Clip;
  local: number; // segundo dentro del archivo fuente
  visible: boolean;
}

// Para cada pista: el clip activo y, si cabe, el siguiente (oculto y precargado).
// Cada clip tiene su propio reproductor: el siguiente ya está colocado en su punto de entrada
// antes de llegar al corte, así que el cambio no espera a que el vídeo salte.
function layersAt(p: Project, t: number): LayerInfo[] {
  const out: LayerInfo[] = [];
  for (const track of p.tracks) {
    if (track.kind === 'video' && track.hidden) continue;
    const cur = track.clips.find((c) => t >= c.start && t < clipEnd(c));
    if (cur) out.push({ key: cur.id, track, clip: cur, local: cur.in + (t - cur.start), visible: true });
    const next = track.clips.find((c) => c.start > t && c.start - t < PRELOAD_AHEAD);
    if (next) out.push({ key: next.id, track, clip: next, local: next.in, visible: false });
  }
  return out;
}

export function Preview({ project, dir, base, proxies, peaks }: { project: Project; dir: string; base: string; proxies: Record<string, string>; peaks: Record<string, Uint8Array> }) {
  const time = useTime();
  const playing = usePlaying();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width: W, height: H } = project;
  const scale = Math.min(box.w / W, box.h / H) || 0;
  const layers = layersAt(project, time);

  // ducking: la música baja cuando se habla (misma curva que en la exportación)
  const duck = useMemo(() => {
    if (!hasDucking(project)) return null;
    const level = Math.min(...project.tracks.map(duckLevel).filter((x): x is number => x != null));
    return duckEnvelope(voiceActivity(project, peaks), { level });
  }, [project, peaks]);

  return (
    <div className="preview" ref={boxRef}>
      <div className="stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {layers.map((l) => {
          const kind = kindOf(l.clip.src);
          const asset = project.assets[l.clip.src];
          // la preview usa la copia ligera si existe; la exportación siempre usa el original
          const url = mediaUrl(base, dir, (kind === 'video' && proxies[l.clip.src]) || l.clip.src, kind === 'html' ? asset?.mtime : undefined);
          const since = l.visible ? time - l.clip.start : 0;
          const style = { visibility: l.visible ? 'visible' : 'hidden', objectFit: objectFit(l.clip.fit), ...zoomStyle(l.clip, since) } as const;
          const ducked = duck && duckLevel(l.track) != null ? envelopeAt(duck, time) : 1;
          const volume = Math.max(0, Math.min(1, (l.clip.volume ?? 1) * ducked));
          if (kind === 'video' || kind === 'audio')
            return (
              <MediaLayer
                key={l.key}
                url={url}
                audioOnly={kind === 'audio' || l.track.kind === 'audio'}
                local={l.local}
                playing={playing && l.visible}
                muted={!!l.track.muted || !l.visible}
                volume={volume}
                style={style}
              />
            );
          if (l.track.kind !== 'video') return null;
          if (kind === 'image') return <img key={l.key} className="layer" src={url} style={style} draggable={false} />;
          if (kind === 'html') return <HtmlLayer key={l.key} url={url} local={l.local} visible={l.visible} zoom={zoomStyle(l.clip, since)} />;
          return null;
        })}
      </div>
      {scale > 0 && layers.length === 0 && <div className="preview-empty">Arrastra vídeos al timeline</div>}
    </div>
  );
}

const MediaLayer = memo(function MediaLayer(props: {
  url: string;
  audioOnly: boolean;
  local: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const { local, playing, muted, volume } = props;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    v.volume = volume;
    if (!playing) {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - local) > 0.005) v.currentTime = local;
    } else {
      // reproduciendo: solo se corrige si el vídeo se ha desviado del reloj
      if (Math.abs(v.currentTime - local) > 0.25) v.currentTime = local;
      if (v.paused) v.play().catch(() => {});
    }
  }, [local, playing, muted, volume]);

  if (props.audioOnly) return <audio ref={ref} src={props.url} preload="auto" />;
  return <video ref={ref} className="layer" src={props.url} preload="auto" playsInline style={props.style} />;
});

function HtmlLayer({ url, local, visible, zoom }: { url: string; local: number; visible: boolean; zoom: React.CSSProperties }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'editor-seek', t: local }, '*');
  }, [local]);

  useEffect(() => {
    // cuando la página termina de cargar, se le manda el instante actual
    const onMsg = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data?.type === 'editor-ready') {
        ref.current?.contentWindow?.postMessage({ type: 'editor-seek', t: localRef.current }, '*');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return <iframe ref={ref} className="layer html-layer" src={url} style={{ visibility: visible ? 'visible' : 'hidden', ...zoom }} tabIndex={-1} />;
}
