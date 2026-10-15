import type { Asset, Project, Range } from '../core/project.mjs';

export interface ExportProgress {
  phase: string;
  label: string;
  value: number;
}

export interface EditorApi {
  info(): Promise<{ mediaBase: string; recent: string[]; openOnStart: string | null }>;
  openProject(dir?: string): Promise<{ dir: string; project: Project } | null>;
  newProject(opts?: { name?: string }): Promise<{ dir: string; project: Project } | null>;
  saveProject(p: Project): Promise<void>;
  importMedia(paths?: string[]): Promise<Record<string, Asset>>;
  detectSilences(args: { project: Project; clipId: string; opts?: { noise?: number; minDuration?: number; pad?: number } }): Promise<Range[]>;
  exportVideo(p: Project): Promise<string | null>;
  cancelExport(): Promise<void>;
  reveal(path: string): Promise<void>;
  pathForFile(file: File): string;
  onExternalChange(cb: (p: Project) => void): () => void;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
  onError(cb: (msg: string) => void): () => void;
}

declare global {
  interface Window {
    editor: EditorApi;
  }
}

export const api = window.editor;

// URL del servidor local para un src del proyecto.
export function mediaUrl(base: string, dir: string, src: string, version?: number) {
  const abs = /^([A-Za-z]:)?[\\/]/.test(src) ? src : dir.replace(/\\/g, '/') + '/' + src;
  const url = base + abs.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  return version ? `${url}?v=${Math.round(version)}` : url;
}

export function fileName(src: string) {
  return src.split(/[\\/]/).pop() || src;
}
