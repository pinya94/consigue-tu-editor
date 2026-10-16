# Kit de animaciones de este vídeo

Las animaciones de `media/anim/` las genera el editor con el comando `animate`; no las edites a mano.

- `guion.mjs`: qué animación sale, con qué texto y sobre qué frase. Cada entrada se ancla a palabras
  de la transcripción (`from` / `to`), no a segundos.
- `kit.css` y `kit.js`: el estilo común (oscuro y profesional, acento coral) y los contadores y
  textos que se escriben solos. Puedes cambiarlos: el editor no los sobrescribe.
- El editor coloca las animaciones en las pistas **Escenas** (pantalla completa) y **Rótulos**
  (a un lado de la cara, encima). Si un rótulo pisa una escena, se recorta.

Piezas disponibles (llegan a cada animación como `h.<pieza>`):

- `kin(texto, { x | right, y, width, sub, small })`: frase grande sin caja, palabra a palabra;
  `[palabras]` salen con rotulador naranja.
- `words(texto, d)`: texto que entra palabra a palabra; `*palabras*` en el color de acento.
- `side({ side: 'l' | 'r', kicker, title, text, rows, iconName })`: tarjeta lateral clásica.
- `ring({ x, y, from, to, prefix, suffix, label })`: cifra que cuenta dentro de un anillo que se dibuja.
- `badges([{ icon, text, d }], { x | right, y })`: iconos en círculo que se dibujan solos.
- `stamp(texto, { x, y, good })`: sello inclinado ("Funciona", "0 €"). `confetti({ x, y })`: confeti.
- `cursor({ x, y })`: puntero que llega y hace clic. `chipsUp('+1.500', { x, y })`: fichas que suben.
- `win(título, html, { x, y, w, h })`: ventana flotante.
- `bicho({ x, y, scale, mood })`: el bichito; `mood` = `jump`, `think` (con `say`), `love` o `sweat`.
- `icon(nombre, tamaño)`: iconos de línea (check, x, cut, clock, coin, file, code, gift, mic, spark,
  download, branch, mouse, camera, zoom, wave, folder, term, heart, users, play, bolt, eye, chat…).

En el HTML, `--d:0.4s` es cuándo entra cada elemento (segundos desde que empieza la animación).

Para cambiar algo:

```
editor transcript          # si has cambiado cortes, la transcripción ya está al día
editor animate --dry       # comprueba dónde cae cada animación
editor animate             # genera y coloca
```
