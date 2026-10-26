// Service Worker: зберігає сайт у кеші браузера, щоб після першого відкриття він працював без інтернету.
//
// Кешів два:
//   pyquest-app-<VERSION>              сторінка, стилі, скрипти, CodeMirror, іконки, місії (≈ 0,5 МБ);
//   pyquest-pyodide-<PYODIDE_VERSION>  ядро Pyodide (≈ 13 МБ). Оновлення сайту його не чіпає.
//
// Pyodide при першому відкритті кешується «на льоту»: сторінка запускає Python, коли цей Service Worker
// уже керує нею (див. js/offline.js), і файли проходять через fetch нижче. Так 13 МБ завантажуються
// один раз — HTTP-кеш браузера такі великі файли часто не зберігає.
//
// VERSION у репозиторії — 'dev'. Під час публікації GitHub Actions підставляє сюди хеш файлів сайту,
// тож кожна зміна сайту — це нова версія і банер «Доступне оновлення» в учнів.
// У версії 'dev' (локальна розробка) файли сайту беруться спершу з мережі, щоб правки було видно одразу.
//
// Оновлюєш Pyodide — зміни PYODIDE_VERSION (тест tests/offline.spec.js звіряє її з package.json).
// Усі шляхи відносні: сайт живе в підпапці /python-quest/.

const VERSION = 'dev';
const PYODIDE_VERSION = '314.0.7';

const APP_CACHE = `pyquest-app-${VERSION}`;
const PYODIDE_CACHE = `pyquest-pyodide-${PYODIDE_VERSION}`;

// Файли сайту. Додаєш новий файл у js/, css/ чи icons/ — допиши його сюди.
// Місії додавати не треба: їх список береться з missions/index.json.
const APP_FILES = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/checker.js',
  'js/editor.js',
  'js/offline.js',
  'js/py-worker.js',
  'js/runner.js',
  'js/storage.js',
  'js/ui.js',
  'vendor/codemirror.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'missions/index.json',
];

const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
  .map((name) => `vendor/pyodide/${name}`);

const SCOPE = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Файли сайту — повз HTTP-кеш браузера, щоб у кеш не потрапила суміш старих і нових файлів.
    const fresh = (path) => new Request(path, { cache: 'reload' });
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES.map(fresh));
    const index = await (await app.match('missions/index.json')).json();
    const missions = index.topics.flatMap((topic) => topic.missions).map((id) => `missions/${id}.json`);
    await app.addAll(missions.map(fresh));

    // Перше відкриття: Pyodide закешується на льоту (див. fetch).
    // Оновлення: попередній Pyodide уже в кеші — нову версію докачуємо одразу,
    // щоб після оновлення Python працював і без інтернету.
    const keys = await caches.keys();
    if (keys.some((name) => name.startsWith('pyquest-pyodide-'))) await cacheMissingPyodide();
  })());
});

/** Докачує файли Pyodide, яких бракує в кеші. */
async function cacheMissingPyodide() {
  const cache = await caches.open(PYODIDE_CACHE);
  const missing = [];
  for (const path of PYODIDE_FILES) {
    if (!(await cache.match(path))) missing.push(path);
  }
  await cache.addAll(missing);
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, PYODIDE_CACHE];
    for (const name of await caches.keys()) {
      if (name.startsWith('pyquest-') && !keep.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// Повідомлення від сторінки:
//   'skip-waiting'  — учень натиснув «Оновити»: вмикаємо нову версію;
//   'cache-pyodide' — Python готовий: докачуємо Pyodide, якщо він завантажився повз цей Service Worker.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'cache-pyodide') event.waitUntil(cacheMissingPyodide());
});

/** Шукає лише у своїх кешах: стара версія не повинна брати файли з кешу нової. */
async function fromCache(request) {
  return (await (await caches.open(APP_CACHE)).match(request))
    ?? (await (await caches.open(PYODIDE_CACHE)).match(request));
}

async function cacheFirst(request) {
  return (await fromCache(request)) ?? fetch(request);
}

/** Pyodide: з кешу, а якщо його там ще немає — з мережі, і одразу кладемо копію в кеш. */
async function pyodideFromCacheOrNetwork(event) {
  const cached = await fromCache(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.status === 200) {
    const copy = response.clone();
    event.waitUntil(caches.open(PYODIDE_CACHE).then((cache) => cache.put(event.request, copy)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;

  // Відкриття сайту (з будь-яким #/…) — це завжди index.html.
  const path = new URL(request.url).pathname;
  const isPage = request.mode === 'navigate' && (request.url.split(/[?#]/)[0] === SCOPE || path.endsWith('/index.html'));
  const target = isPage ? new Request(new URL('index.html', SCOPE)) : request;

  if (request.url.startsWith(new URL('vendor/pyodide/', SCOPE).href)) {
    event.respondWith(pyodideFromCacheOrNetwork(event));
  } else if (VERSION === 'dev') {
    // Локальна розробка: свіжі файли з мережі, кеш — лише коли мережі немає.
    event.respondWith(fetch(request).catch(() => cacheFirst(target)));
  } else {
    event.respondWith(cacheFirst(target));
  }
});
