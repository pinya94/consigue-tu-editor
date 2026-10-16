// Guion de animaciones de este vídeo. Lo lee el comando `animate` del editor.
// Cada entrada se ancla a palabras de la transcripción, no a segundos:
//   from / to: texto que se dice (o un segundo exacto). Si un corte se ha llevado alguna palabra,
//   el editor prueba con menos (las primeras de `from`, las últimas de `to`).
//   kind: 'escena' (pantalla completa, pista Escenas) o 'rotulo' (a un lado de la cara, pista Rótulos).
//   Opcionales: after (buscar desde ese segundo), lead / tail (margen antes y después), min, dur.
//   html(h): devuelve el contenido. h.t('palabras') = segundo, dentro de la animación, en que se dicen;
//   h.dur = duración; h.kin, h.side, h.ring, h.badges, h.stamp… = piezas del kit (mira LEEME.md).
// Zonas libres para rótulos: izquierda x 60-660, derecha x 1260-1860 (la cara queda en el centro).
//
// Esto es un ejemplo: cambia los textos de from / to por frases que digas en tu vídeo
// (`transcript` las enseña) y comprueba con `animate --dry` dónde cae cada una.

export const guion = [
  { id: '001_hola', kind: 'rotulo', from: 'hola a todos', to: 'bienvenidos',
    html: (h) => h.kin('Hola a [todos]', { x: 70, y: 380, width: 600, sub: 'Bienvenidos' }) },

  { id: '002_tres_cosas', kind: 'rotulo', from: 'tres cosas', to: 'la tercera',
    html: (h) => h.badges([
      { icon: 'check', text: 'Una', d: 0.2 },
      { icon: 'bolt', text: 'Dos', d: h.t('la segunda') },
      { icon: 'spark', text: 'Tres', d: h.t('la tercera') },
    ], { x: 50, y: 360, gap: 0 }) },

  { id: '101_resumen', kind: 'escena', from: 'en resumen', to: 'y eso es todo',
    html: (h) => `<div class="bg wipe"></div><div class="at" style="left:140px;top:260px">
<div class="kicker fade" style="--d:0.1s">En resumen</div>
<div class="h1" style="margin-top:22px">${h.words('Lo *importante* en una frase', 0.25)}</div></div>` +
      h.bicho({ x: 1400, y: 460, scale: 2.2, d: 0.6, mood: 'jump', wave: true }) },
];

// Palabras que whisper escribe mal en este vídeo (opcional): { 'capcat': 'capcut' }
export const aliases = {};
