// Pruebas de la música generada (music --generate): node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLofi, stereoWav } from '../core/music.mjs';

test('la música dura lo que el vídeo, con fundidos y sin saturar', () => {
  const { left, right, sampleRate, bars } = composeLofi(12, { sampleRate: 8000 });
  assert.equal(left.length, 12 * 8000);
  assert.equal(right.length, left.length);
  assert.equal(bars, Math.ceil(12 / ((60 / 84) * 4)));
  assert.equal(left[0], 0);
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  assert.ok(peak <= 0.8901 && peak > 0.8);
  assert.ok(Math.abs(left[left.length - 1]) < 0.01);
  assert.equal(sampleRate, 8000);
});

test('con la misma semilla sale igual', () => {
  const a = composeLofi(16, { sampleRate: 4000, seed: 3 }).left;
  const b = composeLofi(16, { sampleRate: 4000, seed: 3 }).left;
  const c = composeLofi(16, { sampleRate: 4000, seed: 4 }).left;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('el WAV es estéreo de 16 bits', () => {
  const wav = stereoWav(new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0]), 44100);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(v.getInt16(46, true), 16384);
  assert.equal(v.getInt16(48, true), 32767);
  assert.equal(v.getInt16(52, true), -32767);
});
