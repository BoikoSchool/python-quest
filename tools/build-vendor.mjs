// Готує сторонні бібліотеки в папці vendor/. Сам сайт збирання не потребує:
// цей скрипт запускають лише після зміни версій у package.json, а результат комітять.
//
//   node tools/build-vendor.mjs
//
// Що робить:
//   1. CodeMirror 6 → vendor/codemirror.js (один ES-модуль, збирає esbuild).
//   2. Ядро Pyodide → vendor/pyodide/ (копіює 5 потрібних файлів із node_modules/pyodide).
//   3. Ліцензії всього, що потрапило у vendor/ → vendor/LICENSES.txt.

import { build } from 'esbuild';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor');

// Що саме з CodeMirror потрібно сайту. Додаєш новий імпорт у js/editor.js —
// допиши його сюди й перезапусти скрипт.
const CODEMIRROR_EXPORTS = {
  '@codemirror/state': ['EditorState', 'EditorSelection', 'StateField', 'StateEffect', 'Compartment', 'Prec'],
  '@codemirror/view': [
    'EditorView', 'Decoration', 'keymap', 'lineNumbers',
    'highlightActiveLine', 'highlightActiveLineGutter', 'placeholder',
  ],
  '@codemirror/commands': [
    'defaultKeymap', 'history', 'historyKeymap', 'indentWithTab',
    'undo', 'redo', 'indentMore', 'indentLess',
  ],
  '@codemirror/language': ['indentUnit', 'indentOnInput', 'bracketMatching', 'syntaxHighlighting', 'HighlightStyle'],
  '@codemirror/lang-python': ['python'],
  '@lezer/highlight': ['tags'],
};

// Ядро Pyodide. Решта файлів пакета (типи, консолі, source map) сайту не потрібна.
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

// Браузери, які ми підтримуємо (мінімум, на якому тестують Pyodide).
const TARGETS = ['safari16.4', 'chrome112', 'firefox112'];

/** Збирає один ES-модуль із переліку експортів. Повертає назви npm-пакетів, що потрапили в бандл. */
async function bundle({ exportsByPackage, outfile, title }) {
  const entry = Object.entries(exportsByPackage)
    .map(([pkg, names]) => `export { ${names.join(', ')} } from '${pkg}';`)
    .join('\n');

  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'vendor-entry.js', loader: 'js' },
    absWorkingDir: root,
    bundle: true,
    format: 'esm',
    minify: true,
    target: TARGETS,
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
    banner: { js: `/* ${title} для Python Quest. Згенеровано tools/build-vendor.mjs — не редагуй вручну. Ліцензії: vendor/LICENSES.txt */` },
    outfile,
  });

  // Із шляхів на кшталт node_modules/@codemirror/view/dist/index.js дістаємо назву пакета.
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(match[1]);
  }
  return [...packages].sort();
}

/** Текст ліцензії npm-пакета (з файлу LICENSE, якщо він є). */
async function licenseSection(pkg) {
  const pkgDir = join(root, 'node_modules', pkg);
  const meta = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
  const header = `${meta.name} ${meta.version} — ${meta.license ?? 'ліцензію не вказано'}`;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    const file = join(pkgDir, name);
    if (existsSync(file)) return `${header}\n\n${(await readFile(file, 'utf8')).trim()}`;
  }
  return header;
}

async function copyPyodide() {
  const from = join(root, 'node_modules', 'pyodide');
  const to = join(vendorDir, 'pyodide');
  // Чистимо папку, щоб після оновлення не лишилися файли старої версії.
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const file of PYODIDE_FILES) {
    await copyFile(join(from, file), join(to, file));
    await chmod(join(to, file), 0o644); // у npm-пакеті wasm-файл позначено як виконуваний — нам це не потрібно
  }
  const meta = JSON.parse(await readFile(join(from, 'package.json'), 'utf8'));
  return meta.version;
}

async function sizeKb(file) {
  return Math.round((await stat(file)).size / 1024);
}

await mkdir(vendorDir, { recursive: true });

const codemirrorFile = join(vendorDir, 'codemirror.js');
const codemirrorPackages = await bundle({
  exportsByPackage: CODEMIRROR_EXPORTS,
  outfile: codemirrorFile,
  title: 'CodeMirror 6',
});

const pyodideVersion = await copyPyodide();

const licenses = [
  'Сторонні бібліотеки в папці vendor/ та їхні ліцензії.',
  'Файл згенеровано tools/build-vendor.mjs — не редагуй вручну.',
  '',
  '='.repeat(72),
  `pyodide ${pyodideVersion} — MPL-2.0 (vendor/pyodide/)`,
  '',
  'Pyodide поширюється за Mozilla Public License 2.0 і містить CPython (Python Software',
  'Foundation License) та інші компоненти з власними ліцензіями. Файли скопійовано без змін',
  'з npm-пакета pyodide. Повний текст ліцензій і вихідний код:',
  'https://github.com/pyodide/pyodide',
];
for (const pkg of codemirrorPackages) {
  licenses.push('', '='.repeat(72), `${await licenseSection(pkg)}`);
}
await writeFile(join(vendorDir, 'LICENSES.txt'), licenses.join('\n') + '\n');

console.log(`vendor/codemirror.js — ${await sizeKb(codemirrorFile)} КБ (${codemirrorPackages.length} пакетів: ${codemirrorPackages.join(', ')})`);
let pyodideKb = 0;
for (const file of PYODIDE_FILES) pyodideKb += await sizeKb(join(vendorDir, 'pyodide', file));
console.log(`vendor/pyodide/ — Pyodide ${pyodideVersion}, ${PYODIDE_FILES.length} файлів, ${pyodideKb} КБ`);
console.log('vendor/LICENSES.txt — оновлено');
