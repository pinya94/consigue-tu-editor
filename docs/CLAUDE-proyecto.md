# Proyecto de vídeo CupCut

Esta carpeta es un proyecto del editor **CupCut**. El usuario edita en la app visual y tú editas
por código. Ambos trabajáis sobre el mismo archivo, `proyecto.json`. La app vigila ese archivo y
muestra cada cambio al momento. Tus cambios se pueden deshacer con Ctrl+Z en la app.

## Cómo trabajar

Usa la CLI (más segura que tocar el JSON, porque valida y lee la duración de los archivos):

```bash
node "{{CLI}}" info              # empieza siempre por aquí: pistas, clips con sus ids y medios
node "{{CLI}}" help              # todos los comandos
```

Comandos habituales (los tiempos son segundos del timeline; también vale `1:02.5`):

```bash
node "{{CLI}}" add media/toma1.mp4                     # al final de la primera pista de vídeo
node "{{CLI}}" add media/titulo.html --track v2 --at 3  # animación encima, en el segundo 3
node "{{CLI}}" split 12.4                              # corta todo lo que pase por 12.4
node "{{CLI}}" trim c3 --start 5.2 --end 9             # mueve los bordes de un clip
node "{{CLI}}" move c3 20 --track v2
node "{{CLI}}" set c2 volume=0.3 fit=cover
node "{{CLI}}" delete c4 --ripple                      # borra y cierra el hueco
node "{{CLI}}" silences c1                             # lista los silencios
node "{{CLI}}" silences c1 --apply                     # los quita (jump cuts)
node "{{CLI}}" frame 12.5 --out .cupcut/f.png          # fotograma compuesto: míralo para comprobar
node "{{CLI}}" export                                  # MP4 final en export/
```

Para cambios grandes también puedes editar `proyecto.json` directamente. Después ejecuta
`node "{{CLI}}" check` para comprobar que no hay solapes ni errores.

## Formato de proyecto.json

```jsonc
{
  "name": "Mi vídeo", "width": 1920, "height": 1080, "fps": 30,
  "assets": { "media/toma1.mp4": { "kind": "video", "duration": 125.4, "hasAudio": true } }, // lo rellena CupCut
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
- Opcionales del clip: `volume` (1 = original), `fit` (`contain` | `cover` | `stretch`).
- Opcionales de la pista: `muted`, `hidden`.
- En una misma pista los clips no se pueden solapar.
- `src` es relativo a esta carpeta. Los archivos que se guardan en `media/` aparecen solos en la app.

## Animaciones (HTML)

Las animaciones son archivos `.html` en `media/`. CupCut los pinta encima del vídeo con
transparencia, tanto en la preview como en la exportación (fotograma a fotograma).

Reglas:
1. El lienzo mide lo mismo que el proyecto (p. ej. `1920x1080`) y el fondo es **transparente**.
2. Declara la duración: `<meta name="cupcut-duration" content="4">`.
3. Anima con **CSS** (`@keyframes`, `animation`) o con la Web Animations API. CupCut controla el
   reloj, así que no hace falta nada más. El segundo 0 del archivo es el inicio del clip.
4. Si animas con JS (canvas, GSAP…), no uses `requestAnimationFrame` ni temporizadores para
   avanzar el tiempo. Define `window.cupcutSeek = (t) => { /* pinta el estado del segundo t */ }`.
   Debe ser determinista: el mismo `t` siempre da la misma imagen.
5. Todo en local (sin CDNs): fuentes y librerías dentro de `media/` con rutas relativas.

Ejemplo mínimo:

```html
<!doctype html>
<html><head><meta charset="utf-8"><meta name="cupcut-duration" content="3">
<style>
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
  h1 { position: absolute; left: 120px; bottom: 140px; margin: 0; color: #fff; font: 800 84px 'Segoe UI';
       opacity: 0; animation: entra .6s ease-out .2s forwards; }
  @keyframes entra { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: none } }
</style></head>
<body><h1>Título</h1></body></html>
```

Después: `node "{{CLI}}" add media/titulo.html --track v2 --at 3`. Comprueba cómo queda con
`frame` y mirando el PNG.
