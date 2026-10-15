// Estado del proyecto con deshacer / rehacer.
import { useCallback, useRef, useState } from 'react';
import type { Project } from '../core/project.mjs';

const LIMIT = 200;

export function useHistory(initial: Project) {
  const [state, setState] = useState({ past: [] as Project[], present: initial, future: [] as Project[], draft: null as Project | null });
  const ref = useRef(state);
  ref.current = state;

  // Cambio definitivo (entra en el historial)
  const commit = useCallback((p: Project) => {
    setState((s) => (p === s.present ? { ...s, draft: null } : { past: [...s.past, s.present].slice(-LIMIT), present: p, future: [], draft: null }));
  }, []);
  // Cambio provisional mientras se arrastra algo (no entra en el historial)
  const preview = useCallback((p: Project | null) => setState((s) => ({ ...s, draft: p })), []);
  // Sustituye sin historial (p. ej. metadatos que llegan del disco)
  const replace = useCallback((p: Project) => setState((s) => ({ ...s, present: p, draft: null })), []);
  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], draft: null } : s));
  }, []);
  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), draft: null } : s));
  }, []);

  return {
    project: state.draft || state.present,
    saved: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    current: () => ref.current.present,
    commit,
    preview,
    replace,
    undo,
    redo,
  };
}
