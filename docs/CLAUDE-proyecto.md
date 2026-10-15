# Proyecto de vídeo de "{{NAME}}"

Esta carpeta es un proyecto del editor de vídeo **{{NAME}}** (en adelante, "el editor"). El usuario edita en la app visual y tú editas
por código. Ambos trabajáis sobre el mismo archivo, `proyecto.json`. La app vigila ese archivo y
muestra cada cambio al momento. Tus cambios se pueden deshacer con Ctrl+Z en la app.

> Este archivo lo genera el editor y se actualiza solo. Para notas propias del proyecto usa `NOTAS.md`.

## Cómo trabajar

Usa la CLI. Es más segura que tocar el JSON porque valida y lee la duración de los archivos.

```bash
{{EDITOR}} info              # empieza siempre por aquí: pistas, clips con sus ids y medios
{{EDITOR}} help              # todos los comandos
```

Comandos habituales (los tiempos son segundos del timeline; también vale `1:02.5`):

```bash
{{EDITOR}} add media/toma1.mp4                       # al final de la primera pista de vídeo
{{EDITOR}} add media/titulo.html --track v2 --at 3   # animación encima, en el segundo 3
{{EDITOR}} split 12.4                                # corta todo lo que pase por 12.4
{{EDITOR}} trim c3 --start 5.2 --end 9               # mueve los bordes de un clip
{{EDITOR}} move c3 20 --track v2
{{EDITOR}} set c2 volume=0.3 fit=cover
{{EDITOR}} set c5 zoom=1.2 zoomX=0.5 zoomY=0.35      # acercamiento del 20 % hacia la cara
{{EDITOR}} delete c4 --ripple                        # borra y cierra el hueco
{{EDITOR}} silences c1                               # lista los silencios (umbral automático)
{{EDITOR}} silences c1 --apply                       # los quita (jump cuts) con márgenes buenos
{{EDITOR}} sheet c1 --every 2                        # hojas de miniaturas para revisar el vídeo
{{EDITOR}} frame 12.5 --out .editor/f.png            # fotograma compuesto
{{EDITOR}} review                                    # 360p + audio WAV 16 kHz del montaje, muy ligero
{{EDITOR}} export --draft                            # borrador rápido a 480p para revisar entero
{{EDITOR}} export                                    # MP4 final en export/ (-14 LUFS)
```

**No pidas ni copies los vídeos originales**: pesan cientos de MB. Para revisar usa `review`, que deja en
`.editor/review/` un vídeo de 360p (pocos MB) y el audio en WAV mono de 16 kHz, listo para transcribir.

**Para ver el vídeo**: `sheet` genera imágenes con 30 miniaturas cada una y el segundo del timeline
marcado en cada miniatura. Léelas con tu herramienta de leer imágenes. `frame` sirve para comprobar
un instante concreto con todas las capas, animaciones incluidas. Comprueba siempre tu trabajo así
antes de darlo por bueno.

Para cambios grandes también puedes editar `proyecto.json` directamente. Después ejecuta
`{{EDITOR}} check` para comprobar que no hay solapes ni errores.

## Formato de proyecto.json

```jsonc
{
  "name": "Mi vídeo", "width": 1920, "height": 1080, "fps": 30,
  "assets": { "media/toma1.mp4": { "kind": "video", "duration": 125.4, "hasAudio": true } }, // lo rellena el editor
  "tracks": [                       // de ABAJO a ARRIBA: la última pista de vídeo se ve encima
    { "id": "v1", "kind": "video", "name": "Vídeo 1", "clips": [
      { "id": "c1", "src": "media/toma1.mp4", "start": 0, "in": 2.5, "duration": 10 }
    ]},
    { "id": "v2", "kind": "video", "name": "Animaciones", "clips": [] },
    { "id": "a1", "kind": "audio", "name": "Audio 1", "muted": false, "clips": [] }
  ]
}
```

- `start`: dónde empieza el clip en el timeline. `in`: desde qué segundo del archivo original.
  `duration`: cuánto dura.
- Opcionales del clip:
  - `volume` (1 = original).
  - `fit` (`contain` | `cover` | `stretch`).
  - `zoom` (1 = normal, 1.2 = 20 % más cerca, máximo 5).
  - `zoomX` y `zoomY`: punto hacia el que se acerca el zoom, de 0 a 1. `0.5, 0.5` es el centro;
    `0.5, 0.3` apunta más arriba, donde suele estar la cara.
- Opcionales de la pista: `muted`, `hidden`.
- En una misma pista los clips no se pueden solapar.
- `src` es relativo a esta carpeta. Los archivos que se guardan en `media/` aparecen solos en la app.

## Animaciones (HTML)

Las animaciones son archivos `.html` en `media/`. El editor los pinta encima del vídeo, tanto en la
preview como en la exportación (fotograma a fotograma).

Reglas:
1. El lienzo mide lo mismo que el proyecto (p. ej. `1920x1080`).
   - **Superpuesta** (rótulos, flechas, textos encima de la persona): fondo `transparent`.
   - **A pantalla completa** (tapa el vídeo): fondo opaco que cubra todo el lienzo.
2. Declara la duración: `<meta name="animation-duration" content="4">`.
3. Anima con **CSS** (`@keyframes`, `animation`) o con la Web Animations API. El editor controla el
   reloj, así que no hace falta nada más. El segundo 0 del archivo es el inicio del clip.
4. Si animas con JS (canvas, GSAP…), no uses `requestAnimationFrame` ni temporizadores para
   avanzar el tiempo. Define `window.seekAnimation = (t) => { /* pinta el estado del segundo t */ }`.
   Debe ser determinista: el mismo `t` siempre da la misma imagen.
5. Todo en local, sin CDNs: fuentes y librerías dentro de `media/`, con rutas relativas.
6. Pon las animaciones en una pista por encima del vídeo (`v2`; si hace falta, crea otra con
   `track add video`).
7. Si el clip dura más que la animación, la animación se queda congelada en su último estado. Ajusta
   la duración del HTML a la del hueco que tiene que cubrir.

Ejemplo mínimo (superpuesta):

```html
<!doctype html>
<html><head><meta charset="utf-8"><meta name="animation-duration" content="3">
<style>
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
  h1 { position: absolute; left: 120px; bottom: 140px; margin: 0; color: #fff; font: 800 84px 'Segoe UI';
       opacity: 0; animation: entra .6s ease-out .2s forwards; }
  @keyframes entra { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: none } }
</style></head>
<body><h1>Título</h1></body></html>
```

Después: `{{EDITOR}} add media/titulo.html --track v2 --at 3`. Comprueba cómo queda con `frame` y
mirando el PNG.

## Recetas

### Quitar silencios sin que suene acelerado

`silences --apply` ya aplica unas reglas seguras; no las bajes sin motivo:
- umbral calculado con el ruido de fondo de cada clip (`--noise auto`);
- solo quita pausas de más de 0,6 s (`--min`): las pausas naturales se quedan;
- deja 0,1 s antes de hablar y 0,22 s después (`--pad-before`, `--pad-after`) para no comerse finales;
- nunca deja trozos de menos de 0,8 s (`--min-clip`): un vídeo con cientos de clips diminutos se ve mal;
- al exportar, cada corte lleva un fundido de audio de 15 ms, así que no hay chasquidos.

Nunca cortes a mitad de frase: corta solo en silencios. Después, revisa con `export --draft` o `review`.

### Acercamientos (zoom) en los cortes

Pon zoom **solo cuando cambia la frase o la idea**, no en cada corte: si alternas en cada microcorte el
vídeo se ve nervioso. Un buen ritmo es un cambio de zoom cada 5–15 s, por ejemplo `1` → `1.15` → `1`.
Para que el zoom no cambie en un corte, pon el mismo valor en los clips de esa idea. Centra el zoom en la
cara: mira un fotograma, estima dónde está (de 0 a 1 en horizontal y vertical) y úsalo como
`zoomX`/`zoomY`. Para remarcar una frase importante, usa un zoom mayor (1.3) en ese clip.

### Animación a pantalla completa cuando la persona no mira a cámara

1. Revisa el vídeo con `sheet <clip> --every 1`, o `--every 0.5` para más precisión. Apunta los
   tramos en los que la persona no mira a cámara: mira hacia abajo, a un lado, lee una pantalla…
   Junta los tramos separados por menos de 1 s.
2. A cada tramo añádele margen: empieza un poco antes y acaba un poco después. Por defecto,
   **0,4 s antes y 0,4 s después**, para que el cambio no coincida con el movimiento de los ojos.
3. Decide el contenido según lo que se dice en ese tramo. El editor no transcribe el audio: usa una
   transcripción si el usuario te la da, o pregúntale qué dice ahí. Crea una animación
   **a pantalla completa** (fondo opaco) que ilustre lo que está diciendo. Dale la duración exacta
   del tramo con margen.
4. Colócala en `v2` con `--at` (inicio del tramo menos el margen) y `--duration`. El audio sigue
   sonando debajo.
5. Comprueba el principio, la mitad y el final de cada tramo con `frame`.
