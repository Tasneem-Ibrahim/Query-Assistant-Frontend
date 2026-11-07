import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(root, '.' + relative);
    if (!target.startsWith(root) || !['.html', '.css', '.js', '.png', '.svg'].includes(path.extname(target))) {
      res.writeHead(404).end('Not found'); return;
    }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': `${types[path.extname(target)]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Query Assistant is ready at http://localhost:3000'));
