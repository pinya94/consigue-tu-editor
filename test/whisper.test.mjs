// Pruebas de la parte de whisper que no necesita whisper instalado: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dtwPreset, download, levelsOf } from '../core/whisper.mjs';
import { readWavSamples, writeWav } from '../core/media.mjs';

test('elige el preset de alineación por palabra según el modelo', () => {
  assert.equal(dtwPreset('F:/w/ggml-medium-q5_0.bin'), 'medium');
  assert.equal(dtwPreset('ggml-small.bin'), 'small');
  assert.equal(dtwPreset('ggml-base.en.bin'), 'base.en');
  assert.equal(dtwPreset('ggml-large-v3-turbo-q5_0.bin'), 'large.v3.turbo');
  assert.equal(dtwPreset('modelo-raro.bin'), null);
});

test('descarga a un archivo temporal y lo renombra al acabar', async () => {
  const body = Buffer.alloc(300000, 7);
  const server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Length': body.length }).end(body));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-test-'));
  try {
    const out = path.join(dir, 'modelo.bin');
    const log = [];
    await download(`http://127.0.0.1:${server.address().port}/x`, out, (s) => log.push(s));
    assert.equal(fs.statSync(out).size, body.length);
    assert.ok(!fs.existsSync(out + '.part'));
    assert.match(log.at(-1), /100 %/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WAV: escribir, leer y medir el nivel por ventanas de 10 ms', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-test-'));
  try {
    const s = new Int16Array(16000); // 1 s: silencio y luego un tono
    for (let i = 8000; i < 16000; i++) s[i] = Math.round(Math.sin(i / 5) * 16000);
    const f = path.join(dir, 'a.wav');
    writeWav(f, s, 16000);
    const r = readWavSamples(f);
    assert.equal(r.rate, 16000);
    assert.deepEqual(Array.from(r.samples.slice(8000, 8010)), Array.from(s.slice(8000, 8010)));
    const lv = levelsOf(r.samples, r.rate);
    assert.equal(lv.length, 100);
    assert.equal(lv[10], -100);
    assert.ok(lv[90] > -10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
