# Código de "Consigue tu editor de vídeo optimizado para Claude gratis"

Nombre técnico corto: `consigue-tu-editor` (repo, paquete) / `ConsigueTuEditor.exe`.

Editor de vídeo de escritorio pensado para editar a medias con Claude. Usa Electron, React,
TypeScript y FFmpeg (binarios de `ffmpeg-static` y `ffprobe-static`). La UI está en español.

## Estructura

- `core/project.mjs`: formato de `proyecto.json` y operaciones puras (cortar, recortar, mover,
  quitar rangos…). Sin Node ni DOM. Lo usan la UI, el proceso principal y la CLI. Tipos en `project.d.mts`.
- `core/media.mjs`: disco y FFmpeg (leer metadatos, detectar silencios, cargar y guardar de forma atómica).
- `core/export.mjs`: composición final con un `filter_complex` de FFmpeg.
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
