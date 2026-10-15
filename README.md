# Consigue tu editor de vídeo optimizado para Claude gratis

**Editor de vídeo de escritorio para editar a medias con Claude.**

**[⬇ Descargar para Windows](https://github.com/pinya94/consigue-tu-editor/releases/latest/download/ConsigueTuEditor-Setup.exe)** · [Página web](https://pinya94.github.io/consigue-tu-editor/)

Es un editor sencillo: timeline con pistas, cortes, recortes, preview y exportación a MP4.
Lo especial es que está pensado para trabajar junto a [Claude Code](https://claude.com/claude-code).
Tú montas el vídeo con el ratón y Claude trabaja sobre el mismo proyecto por código: quita
silencios, hace acercamientos, crea animaciones… Cada cambio aparece al momento en tu pantalla.

No tiene subtítulos, transiciones ni efectos. No le hacen falta: esas cosas se las pides a Claude,
que las crea como animaciones.

---

## Descargar e instalar (Windows)

1. Descarga `ConsigueTuEditor-Setup.exe` de la página de [**Releases**](https://github.com/pinya94/consigue-tu-editor/releases/latest).
2. Ábrelo. Se instala en tu usuario, sin pedir permisos de administrador, y crea un acceso directo.
3. Windows puede mostrar el aviso *"Windows protegió su PC"*, porque la app no está firmada. Pulsa
   **Más información → Ejecutar de todas formas**.

FFmpeg viene incluido; no hace falta instalar nada más. Para trabajar con Claude necesitas
[Claude Code](https://claude.com/claude-code).

---

## Primeros pasos

1. Abre el editor y pulsa **Nuevo proyecto**. Elige una carpeta vacía: ahí se guardará todo.
2. Arrastra tus vídeos al timeline, o usa **Importar**. Lo que copies dentro de la carpeta `media/`
   del proyecto aparece solo en la biblioteca.
3. Edita:

| Acción | Cómo |
|---|---|
| Reproducir / pausa | `Espacio` |
| Cortar en la cabeza lectora | `S` o el botón ✂ |
| Mover un clip | Arrástralo (se pega a los bordes de otros clips; con `Alt`, sin imán) |
| Recortar | Arrastra el borde izquierdo o derecho del clip |
| Borrar / borrar y cerrar el hueco | `Supr` / `Mayús+Supr` |
| Fotograma a fotograma / de segundo en segundo | `←` `→` / `Mayús+←` `Mayús+→` |
| Deshacer / rehacer | `Ctrl+Z` / `Ctrl+Y` |
| Zoom del timeline | `Ctrl+rueda`, `+` `−` o el deslizador |
| Exportar | `Ctrl+E` o el botón **Exportar** (1080p, volumen normalizado para YouTube) |
| Revisar rápido | Botón **Borrador rápido**: 480p en poco tiempo para ver el montaje entero |

4. Al seleccionar un clip, en el panel derecho puedes cambiar el volumen, el **zoom** y su punto de
   enfoque, y **detectar silencios**. Los silencios se marcan en rojo en el timeline y se quitan
   con un clic. El umbral se calcula solo con el ruido de fondo, se respetan las pausas naturales y
   cada corte lleva un fundido de audio para que no suene brusco.
5. La preview usa **copias ligeras** de tus vídeos (540p), que el editor crea solo en segundo plano. Así
   va fluida aunque el original sea un 1080p de OBS de cientos de MB. Al exportar siempre se usa el
   original. Con el botón *Preview ligera / original* puedes cambiar entre las dos.
6. En el timeline se ve la **forma de onda** del audio de cada clip, para ver dónde hablas y dónde cortar.
7. Para poner **música de fondo**, añádela en una pista de audio y pulsa el botón ⤓ de esa pista
   (*ducking*): la música baja sola cuando hablas y vuelve a subir en las pausas, en la preview y al exportar.

---

## Trabajar con Claude

Cada proyecto tiene un archivo `CLAUDE.md` que explica a Claude cómo funciona el editor. No tienes que
explicarle nada:

1. Abre una terminal en la carpeta del proyecto (en el Explorador: clic derecho → *Abrir en Terminal*).
2. Escribe `claude`.
3. Pídele lo que quieras, con el editor abierto para ver los cambios en directo.

Ejemplos:

> Quita todos los silencios del vídeo principal.

> Añade zoom en los cortes: alterna entre normal y un 15 % más cerca, centrado en mi cara.

> Haz una animación de título con el texto "Cómo empezar a invertir" en el segundo 2.

> Revisa el vídeo y, donde no mire a cámara, pon una animación a pantalla completa que ilustre lo
> que estoy contando. Que empiece un poco antes y acabe un poco después.

> Transcribe el vídeo y quita las tomas repetidas.

> Quita desde "bueno, antes de empezar" hasta "vamos al lío".

> Pon esta canción de fondo, que baje cuando hablo.

> Exporta el vídeo.

Si no te gusta algo, pulsa `Ctrl+Z` en el editor: los cambios de Claude se deshacen igual que los tuyos.

### Zoom

Cada clip tiene un **zoom** (1 = normal, 1.2 = 20 % más cerca) y un **punto de enfoque** (`zoomX`,
`zoomY`, de 0 a 1), que indica hacia dónde se acerca. Lo típico en vídeos hablados es alternar el
zoom cuando cambia la frase o la idea (`1` → `1.15` → `1` → `1.2`…). Así los cortes se notan menos y el
vídeo tiene más ritmo. Puedes ponerlo a mano en el panel derecho o pedírselo a Claude, que mira los
fotogramas para centrar el zoom en tu cara.

El zoom también puede ser **animado**, como en CapCut: con *Zoom final* (`zoomTo`) el clip pasa
suavemente de su zoom al final en el tiempo que digas (`zoomTime`). Con `zoom=1 zoomTo=1.2 zoomTime=0.4`
tienes un *punch-in* suave; sin `zoomTime`, un acercamiento lento durante todo el clip.

### Animaciones

Las animaciones son archivos **HTML + CSS** que Claude escribe en la carpeta `media/`. Se colocan en
una pista por encima del vídeo y se tratan como cualquier otro clip: se mueven, se recortan y se
borran igual. Hay dos tipos:

- **Superpuestas**: con fondo transparente. Rótulos, flechas, textos o iconos encima de ti.
- **A pantalla completa**: con fondo opaco. Tapan el vídeo mientras se sigue oyendo tu voz. Son
  ideales para explicar algo con gráficos o para cubrir momentos en los que no miras a cámara.

El editor las reproduce en la preview y, al exportar, las convierte en vídeo fotograma a fotograma, así
que el resultado es exactamente lo que ves.

Si quieres escribirlas tú, estas son las reglas:

1. El lienzo mide lo mismo que el proyecto (por defecto 1920×1080).
2. El fondo es `transparent` (superpuesta) u opaco (pantalla completa).
3. La duración se declara con `<meta name="animation-duration" content="4">`.
4. Se anima con CSS (`@keyframes`). El editor controla el reloj, así que la animación se puede
   recorrer hacia delante y hacia atrás sin problema.
5. Para animaciones hechas con JavaScript, define `window.seekAnimation = (t) => { … }` para que
   dibuje el instante `t` en segundos.

Hay un ejemplo completo en [`docs/ejemplo-animacion.html`](docs/ejemplo-animacion.html).

### Cuando no miras a cámara

Esta receta funciona muy bien con Claude. Claude revisa el vídeo con hojas de miniaturas (una imagen
con muchos fotogramas y su segundo marcado). Así encuentra los tramos en los que miras hacia abajo
o a un lado. Después crea una animación a pantalla completa para cada tramo, con un margen de unos
0,4 s antes y después, para que el cambio de plano no coincida justo con el movimiento de los ojos.

Para que las animaciones ilustren lo que dices, Claude usa la transcripción del vídeo (ver abajo).

### Transcripción y edición por texto

El editor transcribe tu voz con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), en tu ordenador
y sin conexión. Whisper no viene incluido porque pesa bastante: la primera vez, Claude te preguntará
si lo descarga (unos 700 MB con tarjeta NVIDIA, o 190 MB en la versión para CPU) y dónde guardarlo.
Si tu disco C: va justo, guárdalo en otro disco.

Con la transcripción:
- `.editor/transcript.json` tiene **cada palabra con su segundo en el timeline**. Los tiempos se
  ajustan a tu voz real (alineación por palabra), así que los cortes caen en silencios de verdad y
  no se comen finales de palabra.
- Cada vídeo se transcribe **una sola vez**. Cuando cortas, la transcripción se actualiza sola.
- `retakes` encuentra las **tomas repetidas** (cuando empiezas una frase, te equivocas y la repites),
  las palabras repetidas ("y bueno, y bueno"), las muletillas y las frases que se quedan a medias, y
  propone quitar la primera toma.
- `cut-text "desde…" "hasta…"` quita un trozo diciendo por qué frase empieza y por cuál acaba.
- `verify` revisa el montaje: palabras partidas por un corte, cortes sin pausa y tomas repetidas
  que quedan. Además vuelve a transcribir el audio ya cortado para ver si se entiende.

---

## La línea de comandos

Claude usa la CLI, pero tú también puedes usarla. Con la app instalada:

```bash
"%LOCALAPPDATA%\Programs\Consigue tu editor de video optimizado para Claude gratis\ConsigueTuEditor.exe" --cli help
```

| Comando | Qué hace |
|---|---|
| `info` | Pistas, clips (con sus ids) y medios |
| `add <archivo> [--track v2] [--at 3]` | Añade un clip |
| `split <t>` · `trim <clip> --start/--end` · `move <clip> <t>` | Cortar, recortar, mover |
| `set <clip> zoom=1.2 zoomX=0.5 zoomY=0.4 volume=0.5` | Cambiar propiedades (`zoomTo=1.2 zoomTime=0.4`: zoom animado) |
| `delete <clip> [--ripple]` | Borrar (y cerrar el hueco) |
| `silences <clip> [--apply]` | Detectar (y quitar) silencios |
| `sheet <clip> [--every 2]` | Hojas de miniaturas para revisar el vídeo |
| `frame <t>` | Fotograma final compuesto en PNG |
| `review` | Vídeo de 360p y audio WAV muy ligeros, para revisar el montaje |
| `transcribe [--prompt "Claude, CapCut"]` | Transcribe la voz: `.editor/transcript.json` con cada palabra y su tiempo en el timeline |
| `transcript [--words]` | Muestra la transcripción del montaje por frases (o palabra a palabra, numeradas) |
| `retakes [--apply all\|1,3]` | Tomas repetidas, repeticiones, muletillas y frases a medias (y quitarlas) |
| `cut-text "desde…" "hasta…"` · `cut-words 120-135` | Cortar por texto o por número de palabra, ajustado a los silencios |
| `verify [--quick]` | Revisa los cortes y vuelve a transcribir el montaje para ver si se entiende |
| `music <archivo> [--duck 0.25]` | Música de fondo que baja sola cuando hablas |
| `whisper install --dir D:/whisper` | Descarga whisper.cpp y el modelo en español |
| `export [--draft]` | Exportar a MP4 (o un borrador rápido de 480p) |

Todo queda en `proyecto.json`, un JSON legible. Así cualquiera, persona o IA, puede leerlo y
editarlo.

---

## Desarrollo

Necesitas Node.js 20 o superior.

```bash
git clone https://github.com/pinya94/consigue-tu-editor.git
cd consigue-tu-editor
npm install
npm start        # compila la interfaz y abre la app
npm test         # tests del núcleo
npm run dist     # genera el instalador en release/
```

La página de descarga está en `docs/index.html` (lista para GitHub Pages). Estructura: el núcleo (formato y operaciones) está en `core/`, Electron en `electron/`, la interfaz
React en `src/` y la CLI en `cli/`. Hay más detalle en [`CLAUDE.md`](CLAUDE.md).

## Limitaciones

- Solo Windows por ahora.
- Las animaciones HTML tienen que funcionar sin internet: las fuentes y librerías van dentro de `media/`.
- La transcripción necesita descargar whisper.cpp y un modelo aparte. Sin tarjeta NVIDIA va más
  lenta (más o menos lo que dura el vídeo), pero cada vídeo solo se transcribe una vez.

## Colaborar y licencia

¿Ideas, fallos o mejoras? Lee [CONTRIBUTING.md](CONTRIBUTING.md). Los *issues* y *pull requests* son
bienvenidos.

Código abierto con [licencia MIT](LICENSE): puedes usarlo, modificarlo y compartirlo gratis.
