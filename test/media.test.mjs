// Pruebas de las reglas de corte de silencios: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShortPieces } from '../core/media.mjs';

const fmt = (r) => r.map((x) => `${x.start}-${x.end}`).join(' ');

test('no deja trozos hablados más cortos que el mínimo', () => {
  // habla 0-5, silencio 5-6, habla 6-6.3 (muy corto), silencio 6.3-8, habla 8-10
  const r = mergeShortPieces([{ start: 5, end: 6 }, { start: 6.3, end: 8 }], 0, 10, 0.8);
  // se deja el silencio más corto (5-6) para que el trozo corto se una al anterior
  assert.equal(fmt(r), '6.3-8');
});

test('respeta los trozos que ya son largos', () => {
  const r = mergeShortPieces([{ start: 2, end: 3 }, { start: 5, end: 6 }], 0, 10, 0.8);
  assert.equal(fmt(r), '2-3 5-6');
});

test('un trozo corto al principio o al final se une a su vecino', () => {
  assert.equal(fmt(mergeShortPieces([{ start: 0.3, end: 2 }], 0, 10, 0.8)), '');
  assert.equal(fmt(mergeShortPieces([{ start: 5, end: 9.6 }], 0, 10, 0.8)), '');
});
