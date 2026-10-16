// Pruebas de las animaciones ancladas a la transcripción (comando animate): node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normText, wordIndex, findAnchor, layoutGuion, animationPage, GENERATED_MARK, pieces } from '../core/animate.mjs';

// palabras de 0,5 s seguidas, desde el segundo 0
const say = (text, t0 = 0) => text.split(' ').map((w, i) => ({ w, start: t0 + i * 0.5, end: t0 + i * 0.5 + 0.4 }));
const words = [...say('Hola a todos, hoy os enseño el editor de Cloude'), ...say('y al final veremos si vale la pena', 20)];

test('el texto se compara sin mayúsculas, tildes ni signos, y con los alias', () => {
  assert.deepEqual(normText('¿Vídeo, CapCut?'), ['video', 'capcut']);
  assert.deepEqual(normText('con Cloude'), ['con', 'claude']);
  assert.deepEqual(normText('capcat', { capcat: 'capcut' }), ['capcut']);
});

test('encuentra una frase y da el inicio de la primera palabra y el final de la última', () => {
  const r = findAnchor(wordIndex(words), 'os enseño el editor');
  assert.equal(r.start, 2);
  assert.equal(r.end, 3.9);
  assert.equal(r.used, 4);
  // "Claude" encuentra el "Cloude" de whisper
  assert.equal(findAnchor(wordIndex(words), 'editor de claude').end, 4.9);
});

test('si un corte se ha llevado una palabra, prueba con menos (sin bajar de dos)', () => {
  const idx = wordIndex(words);
  // "fantástico" no se dijo: como inicio valen las primeras palabras…
  const a = findAnchor(idx, 'hoy os enseño fantástico', { side: 'from' });
  assert.equal(a.start, 1.5);
  assert.equal(a.used, 3);
  // …y como final, las últimas
  const b = findAnchor(idx, 'fantástico vale la pena', { side: 'to' });
  assert.equal(b.end, 23.9);
  assert.equal(b.used, 3);
  // con una sola palabra que coincida no basta
  assert.equal(findAnchor(idx, 'hola fantástico maravilloso', { side: 'from' }), null);
});

test('busca a partir de `after`', () => {
  const idx = wordIndex([...say('vale la pena'), ...say('vale la pena', 10)]);
  assert.equal(findAnchor(idx, 'vale la pena').start, 0);
  assert.equal(findAnchor(idx, 'vale la pena', { after: 5 }).start, 10);
});

test('las palabras de whisper con guiones o varias partes se pueden buscar por partes', () => {
  const idx = wordIndex([{ w: 'el', start: 0, end: 0.3 }, { w: 'e-mail', start: 0.4, end: 0.9 }, { w: 'nuevo', start: 1, end: 1.4 }]);
  const r = findAnchor(idx, 'el e mail nuevo');
  assert.equal(r.start, 0);
  assert.equal(r.end, 1.4);
});

test('layoutGuion coloca cada entrada sobre sus palabras, con margen', () => {
  const html = () => '';
  const { placed, skipped } = layoutGuion([
    { id: 'a', kind: 'rotulo', from: 'hoy os enseño', to: 'editor de claude', html },
    { id: 'b', kind: 'rotulo', from: 'esto no se dice nunca', html },
  ], words, { total: 30 });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].start, 1.3); // 1,5 - 0,2 de margen
  assert.equal(placed[0].end, 5.25); // 4,9 + 0,35
  assert.equal(placed[0].dur, 3.95);
  assert.equal(skipped[0].g.id, 'b');
});

test('las escenas mandan: el rótulo que las pisa se recorta, y h.t va con el inicio final', () => {
  const html = () => '';
  const { placed } = layoutGuion([
    { id: 'escena', kind: 'escena', from: 'hola a todos', to: 'hoy os', html },
    { id: 'rotulo', kind: 'rotulo', from: 'todos hoy', to: 'editor de claude', html },
  ], words, { total: 30 });
  const sc = placed.find((x) => x.g.id === 'escena');
  const lb = placed.find((x) => x.g.id === 'rotulo');
  assert.equal(sc.start, 0);
  assert.equal(lb.start, +(sc.end + 0.1).toFixed(3));
  // "editor" se dice en el segundo 3,5 del timeline
  assert.equal(lb.t('editor de claude'), +(3.5 - lb.start).toFixed(2));
});

test('los rótulos que se quedan sin sitio se descartan', () => {
  const html = () => '';
  const { placed, skipped } = layoutGuion([
    { id: 'escena', kind: 'escena', from: 'hola a todos', to: 'editor de claude', html },
    { id: 'rotulo', kind: 'rotulo', from: 'hoy os enseño', to: 'el editor', html },
  ], words, { total: 30 });
  assert.deepEqual(placed.map((x) => x.g.id), ['escena']);
  assert.equal(skipped[0].g.id, 'rotulo');
});

test('la página generada declara su duración, lleva la marca y enlaza el kit', () => {
  const html = animationPage(pieces.kin('Hola [mundo]', { x: 70, y: 300 }), 4.5);
  assert.ok(html.includes('<meta name="animation-duration" content="4.5">'));
  assert.ok(html.includes(GENERATED_MARK));
  assert.ok(html.includes('../kit/kit.css') && html.includes('../kit/kit.js'));
  assert.ok(html.includes('--out:4.05s'));
  assert.ok(html.includes('class="pw mk"'));
});
