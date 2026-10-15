# CupCut

Editor de vídeo de escritorio sencillo, pensado para editar a medias con Claude.

- **Tú**: timeline visual con pistas, cortes, recortes, arrastrar y soltar, preview y exportación a MP4.
- **Claude**: edita el mismo proyecto por código (`proyecto.json` + CLI). La app muestra sus cambios al momento.
- **Animaciones**: archivos HTML/CSS con fondo transparente que se colocan en una pista como cualquier clip.
- **Silencios**: detecta los silencios y los quita (jump cuts) con un clic.

## Abrir

Doble clic en `Abrir CupCut.cmd`, o en una terminal:

```bash
npm start
```

## Para Claude

Cada proyecto nuevo incluye un `CLAUDE.md` con instrucciones. Basta con abrir Claude Code en la
carpeta del proyecto de vídeo. Comandos: `node cli/cupcut.mjs help`.
