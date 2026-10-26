// Робить PNG-іконки сайту з icons/icon.svg. Запускай лише після зміни icon.svg, результат комітять:
//
//   node tools/build-icons.mjs
//
// PNG малює Chromium з Playwright, який уже потрібен для тестів, тож нових залежностей немає.
//   icon-180.png          — iPad: «На екран "Додому"» (apple-touch-icon)
//   icon-192.png, -512    — Android і вкладка браузера, із заокругленими кутами
//   icon-maskable-512.png — Android сам обрізає її під форму іконок телефона

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const ICONS = [
  { file: 'icon-180.png', size: 180, rounded: false }, // iPad заокруглює кути сам
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
];

const svg = await readFile(join(iconsDir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const { file, size, rounded } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html>
      <style>
        html, body { margin: 0; background: transparent; }
        div { width: ${size}px; height: ${size}px; overflow: hidden; border-radius: ${rounded ? Math.round(size * 0.22) : 0}px; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      <div>${svg}</div>`);
    await page.screenshot({ path: join(iconsDir, file), omitBackground: true });
    await page.close();
    console.log(`✓ icons/${file}`);
  }
} finally {
  await browser.close();
}
