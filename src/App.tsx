import { useEffect, useState } from 'react';
import type { Project } from '../core/project.mjs';
import { api } from './api';
import { clock } from './clock';
import { Editor } from './Editor';

type Open = { dir: string; project: Project };

export function App() {
  const [info, setInfo] = useState<{ mediaBase: string; recent: string[] } | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<Open | null>) => {
    setError(null);
    try {
      const r = await fn();
      if (r) {
        clock.setPlaying(false);
        clock.seek(0);
        setOpen(r);
      }
    } catch (e: any) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i);
      const start = i.openOnStart || i.recent[0];
      if (start) run(() => api.openProject(start));
    });
  }, []);

  if (!info) return null;
  if (open) return <Editor key={open.dir} dir={open.dir} initial={open.project} base={info.mediaBase} onClose={() => api.info().then((i) => (setInfo(i), setOpen(null)))} />;

  return (
    <div className="welcome">
      <h1>
        Cup<span>Cut</span>
      </h1>
      <p className="muted">Editor de vídeo para trabajar a medias con Claude</p>
      <div className="welcome-buttons">
        <button className="primary" onClick={() => run(() => api.newProject())}>
          Nuevo proyecto
        </button>
        <button onClick={() => run(() => api.openProject())}>Abrir proyecto…</button>
      </div>
      {error && <p className="error">{error}</p>}
      {info.recent.length > 0 && (
        <div className="recent">
          <div className="subtitle">Recientes</div>
          {info.recent.map((d) => (
            <button key={d} className="recent-item" onClick={() => run(() => api.openProject(d))}>
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
