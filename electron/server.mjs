// Servidor HTTP local para que la app (y el render de animaciones) lean los archivos del proyecto.
// Soporta peticiones Range (necesarias para saltar en los vídeos) y a los HTML les inyecta el
// runtime de animaciones, que permite mover su reloj a cualquier instante.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export async function startMediaServer() {
  const token = crypto.randomBytes(12).toString('hex');
  const prefix = `/t/${token}`;
  const runtimePath = path.join(here, 'anim-runtime.js');

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith(prefix + '/')) {
        res.writeHead(403).end();
        return;
      }
      const rest = url.pathname.slice(prefix.length);
      let file;
      if (rest === '/__editor/runtime.js') file = runtimePath;
      else if (rest.startsWith('/fs/')) file = path.normalize(rest.slice(4).split('/').map(decodeURIComponent).join('/'));
      else {
        res.writeHead(404).end();
        return;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      if (ext === '.html' || ext === '.htm') {
        let html = fs.readFileSync(file, 'utf8');
        const tag = `<script src="${prefix}/__editor/runtime.js"></script>`;
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
        res.writeHead(200, headers).end(html);
        return;
      }
      const size = fs.statSync(file).size;
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        let start = range[1] ? Number(range[1]) : size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        if (!range[1]) end = size - 1;
        if (start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          return;
        }
        end = Math.min(end, size - 1);
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': size });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(file).pipe(res);
      }
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${prefix}/fs/`;
  return {
    server,
    base,
    urlFor(abs) {
      return base + abs.split(path.sep).join('/').split('/').map(encodeURIComponent).join('/');
    },
  };
}
