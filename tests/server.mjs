// Маленький статичний сервер для тестів. Віддає сайт за адресою /python-quest/ —
// так само, як GitHub Pages (сайт у підпапці, без особливих заголовків).
// Тож тести одразу помітять абсолютний шлях на кшталт "/js/app.js".
//
// Одна відмінність: у sw.js замість версії 'dev' підставляється версія з cookie pq-sw
// (без cookie — 'test'), як це робить GitHub Actions під час публікації. Так тести перевіряють
// справжню стратегію кешу, а тест оновлення може «випустити» нову версію лише для себе.
//
//   node tests/server.mjs [порт]      → http://localhost:4173/python-quest/

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = '/python-quest/';
const port = Number(process.argv[2] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === BASE.slice(0, -1)) {
    response.writeHead(301, { Location: BASE }); // GitHub Pages теж додає скісну риску
    response.end();
    return;
  }
  let relative = url.pathname.startsWith(BASE) ? decodeURIComponent(url.pathname.slice(BASE.length)) : null;
  // Службові файли (.git, .claude) на сайті не публікуються — не віддаємо їх і тут.
  if (relative === null || relative.split('/').some((part) => part.startsWith('.'))) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  const file = normalize(join(root, relative));
  if (relative === 'sw.js') {
    const version = request.headers.cookie?.match(/(?:^|;\s*)pq-sw=([\w-]+)/)?.[1] ?? 'test';
    const body = (await readFile(file, 'utf8')).replace("const VERSION = 'dev';", `const VERSION = '${version}';`);
    response.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'max-age=600' });
    response.end(body);
    return;
  }
  try {
    if (!file.startsWith(root)) throw new Error('поза папкою сайту');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('не файл');
    response.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'max-age=600', // як на GitHub Pages
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, () => console.log(`Python Quest: http://localhost:${port}${BASE}`));
