# Código de "Consigue tu editor de vídeo optimizado para Claude gratis"

Nombre técnico corto: `consigue-tu-editor` (repo, paquete) / `ConsigueTuEditor.exe`.

Editor de vídeo de escritorio pensado para editar a medias con Claude. Usa Electron, React,
TypeScript y FFmpeg (binarios de `ffmpeg-static` y `ffprobe-static`). La UI está en español.

## Estructura

- `core/project.mjs`: formato de `proyecto.json` y operaciones puras (cortar, recortar, mover,
  quitar rangos…). Sin Node ni DOM. Lo usan la UI, el proceso principal y la CLI. Tipos en `project.d.mts`.
- `core/media.mjs`: disco y FFmpeg (leer metadatos, detectar silencios, cargar y guardar de forma atómica).
- `core/export.mjs`: exportación por tramos con FFmpeg (zoom animado con `zoompan`, ducking con `amultiply`).
- `core/transcript.mjs`: transcripción pura (sin Node): palabras de whisper, ajuste a la voz, paso al timeline, tomas repetidas, búsqueda de texto y rangos de corte.
- `core/whisper.mjs`: whisper.cpp (instalar, transcribir, caché en `.editor/transcripts/`, `.editor/transcript.json`). Su ubicación se guarda en `%APPDATA%/consigue-tu-editor/whisper.json`.
- `core/waveform.mjs` (picos del audio, `.editor/waveforms/`) y `core/duck.mjs` (curva de ducking, pura; la usan la exportación y la preview).
- `core/pauses.mjs` (pausas muertas del montaje por volumen, pura), `core/animate.mjs` (guion de animaciones anclado a la transcripción y piezas del kit, pura) y `core/music.mjs` (sintetizador de música de fondo lo-fi, puro).
- `docs/kit/`: plantilla del kit de animaciones (`kit.css`, `kit.js`, `guion.mjs`, `LEEME.md`) que `init` y `animate` copian a `media/kit/` de cada proyecto, sin sobrescribir.
- `electron/main.mjs`: ventana, IPC, vigilancia de la carpeta del proyecto y modo `--cli` sin ventana (export/frame).
- `electron/server.mjs`: servidor HTTP local con Range. Inyecta `anim-runtime.js` en los HTML.
- `electron/htmlRender.mjs`: renderiza las animaciones HTML fotograma a fotograma, con alfa (ventana offscreen).
- `src/`: interfaz React (Editor, Timeline, Preview, Panels). `clock.ts` es el reloj de reproducción, fuera de React.
- `cli/editor.mjs`: CLI para Claude.
- `docs/CLAUDE-proyecto.md`: plantilla que `init` copia como `CLAUDE.md` en cada proyecto de vídeo.

## Comandos

- `npm start`: compila la UI y abre la app. `npm run dev`: modo con recarga en caliente.
- `npm test`: tests del núcleo. `npm run typecheck`: TypeScript.
- Revisar la UI sin pantalla: `EDITOR_SNAPSHOT=captura.png npx electron . --project ejemplo`
  (opcional: `EDITOR_SNAPSHOT_JS="__editor.clock.seek(2)"`). Requiere antes `npx vite build`.
- `ejemplo/` es un proyecto de prueba (está en .gitignore).
- El usuario abre la app con un acceso directo del escritorio que lanza `node_modules/electron/dist/electron.exe` sobre esta carpeta y carga `dist/`. Tras cambiar algo de `src/`, ejecuta `npx vite build` para que el acceso directo vea los cambios.
