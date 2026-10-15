// Reloj de reproducción. Va fuera de React para que la cabeza lectora y la preview
// se actualicen 60 veces por segundo sin redibujar todo el timeline.
import { useSyncExternalStore } from 'react';

let time = 0;
let playing = false;
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

export const clock = {
  get time() {
    return time;
  },
  get playing() {
    return playing;
  },
  seek(t: number) {
    time = Math.max(0, t);
    emit();
  },
  setPlaying(v: boolean) {
    playing = v;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

export function useTime() {
  return useSyncExternalStore(clock.subscribe, () => time);
}

export function usePlaying() {
  return useSyncExternalStore(clock.subscribe, () => playing);
}
