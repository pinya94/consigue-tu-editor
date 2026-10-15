// Tipos de core/duck.mjs para la interfaz en TypeScript.
import type { Project, Track } from './project.mjs';
export const PEAKS_RATE: number;
export const DUCK_DEFAULTS: { level: number; attack: number; release: number; hold: number };
export function duckLevel(track: Track | undefined): number | null;
export function hasDucking(p: Project): boolean;
export function peakThreshold(peaks: ArrayLike<number>): number;
export function voiceActivity(p: Project, peaksBySrc: Record<string, Uint8Array | null | undefined>): Uint8Array;
export function duckEnvelope(activity: Uint8Array, opts?: Partial<typeof DUCK_DEFAULTS>): Float32Array;
export function envelopeAt(env: Float32Array | null, t: number): number;
