// Tipos de core/project.mjs para la interfaz en TypeScript.
export type MediaKind = 'video' | 'audio' | 'image' | 'html';
export type TrackKind = 'video' | 'audio';
export type Fit = 'contain' | 'cover' | 'stretch';

export interface Asset {
  kind: MediaKind;
  duration: number | null;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  alpha?: boolean;
  missing?: boolean;
  mtime?: number;
}
export interface Clip {
  id: string;
  src: string;
  start: number;
  in: number;
  duration: number;
  volume?: number;
  fit?: Fit;
  zoom?: number; // 1 = sin zoom, 1.2 = 20 % más cerca
  zoomX?: number; // punto de enfoque del zoom, 0-1 (0.5 = centro)
  zoomY?: number;
  zoomTo?: number; // zoom animado: de `zoom` a `zoomTo`
  zoomTime?: number; // en estos segundos (por defecto, todo el clip)
}
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  duck?: boolean | number; // música: baja (a este volumen, 0.25 por defecto) cuando se habla
  clips: Clip[];
}
export interface Project {
  version: number;
  name: string;
  width: number;
  height: number;
  fps: number;
  assets: Record<string, Asset>;
  tracks: Track[];
}
export interface Range { start: number; end: number }

export const PROJECT_FILE: string;
export const DEFAULT_STILL_DURATION: number;
export function kindOf(src: string): MediaKind | null;
export function trackKindFor(kind: MediaKind): TrackKind;
export function round(t: number): number;
export function snapToFrame(p: Project, t: number): number;
export function clone<T>(p: T): T;
export function createProject(o?: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps'>>): Project;
export function clipEnd(c: Clip): number;
export function allClips(p: Project): Clip[];
export function totalDuration(p: Project): number;
export function findClip(p: Project, id: string): { track: Track; clip: Clip; ti: number; ci: number } | null;
export function findTrack(p: Project, id: string): Track | null;
export function nextId(p: Project, prefix: string): string;
export function sourceDuration(p: Project, src: string): number;
export function activeClipsAt(p: Project, t: number): { track: Track; clip: Clip }[];
export function addTrack(p: Project, kind?: TrackKind, name?: string): { project: Project; trackId: string };
export function removeTrack(p: Project, trackId: string): Project;
export function updateTrack(p: Project, trackId: string, patch: Partial<Track>): Project;
export function addClip(p: Project, o: { src: string; trackId?: string; start?: number; in?: number; duration?: number; volume?: number; fit?: Fit }): { project: Project; clipId: string };
export function splitClip(p: Project, clipId: string, t: number): { project: Project; newId: string | null };
export function splitAt(p: Project, t: number, trackIds?: string[]): Project;
export function trimClip(p: Project, clipId: string, o: { start?: number; end?: number }): Project;
export function moveClip(p: Project, clipId: string, newStart: number, newTrackId?: string): Project;
export function updateClip(p: Project, clipId: string, patch: Partial<Clip>): Project;
export function deleteClips(p: Project, ids: string[], o?: { ripple?: boolean }): Project;
export function removeTimeRanges(p: Project, ranges: Range[]): Project;
export function zoomAt(c: Clip, local: number): number;
export function removeRanges(p: Project, clipId: string, ranges: Range[]): Project;
export function normalize(p: unknown): Project;
export function validate(p: Project): string[];
export function formatTime(t: number, fps?: number): string;
export function parseTime(s: string | number): number;
