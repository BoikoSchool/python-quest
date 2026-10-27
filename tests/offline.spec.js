// Робота без інтернету (Service Worker) і банер «Доступне оновлення».

import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.js';
import { openApp, runButton, setCode } from './helpers.js';

/** Чекає, поки Service Worker закешує сайт і почне керувати сторінкою. */
async function waitForOfflineReady(page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 90_000 });
}

const cacheNames = (page) => page.evaluate(() => caches.keys());

test('після першого відкриття сайт працює без інтернету', async ({ page, context }) => {
  await openApp(page, '#/sandbox');
  await waitForOfflineReady(page);
  expect(await cacheNames(page)).toEqual(expect.arrayContaining(['pyquest-app-test', 'pyquest-pyodide-314.0.7']));

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-python', 'ready', { timeout: 90_000 });
  await setCode(page, 'print(6 * 7)\n');
  await runButton(page).click();
  await expect(page.locator('.console')).toHaveText('42');

  // Місії теж є в кеші.
  await page.goto('./#/');
  await page.locator('a[href="#/m/ticket-office"]').click();
  await expect(page.getByRole('heading', { name: 'Квиткова каса' })).toBeVisible();
});

test('нова версія — банер «Доступне оновлення», після «Оновити» код учня на місці', async ({ page, context, baseURL }) => {
  await openApp(page, '#/sandbox');
  await waitForOfflineReady(page);
  await setCode(page, 'print("моя програма")\n');
  // Кеш «старої версії», який нова версія має прибрати під час активації.
  await page.evaluate(() => caches.open('pyquest-app-old'));

  // «Публікуємо» нову версію лише для цього контексту.
  await context.addCookies([{ name: 'pq-sw', value: 'v2', url: baseURL }]);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  const banner = page.locator('.update-banner');
  await expect(banner).toContainText('Доступне оновлення');

  // Мітка зникне, лише якщо сторінка справді перезавантажилася.
  await page.evaluate(() => { window.beforeUpdate = true; });
  const reloaded = page.waitForEvent('load');
  await banner.getByRole('button', { name: 'Оновити' }).click();
  await reloaded;
  expect(await page.evaluate(() => window.beforeUpdate)).toBeUndefined();
  await expect(page.locator('.cm-content')).toContainText('print("моя програма")');
  await expect.poll(() => cacheNames(page)).toEqual(expect.arrayContaining(['pyquest-app-v2', 'pyquest-pyodide-314.0.7']));
  // Старі кеші нова версія прибирає під час активації — трохи згодом. Перевіряємо на штучному кеші.
  // Ні банер, ні кеш 'pyquest-app-test' тут не перевіряємо: WebKit після перезавантаження сам перевіряє
  // оновлення без cookie, отримує версію 'test' і знову пропонує «оновитися» на неї.
  // Так буває лише з тестовим сервером, на GitHub Pages sw.js однаковий для всіх.
  await expect.poll(() => cacheNames(page)).not.toContain('pyquest-app-old');
});

test('версія Pyodide у sw.js збігається з package.json', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(sw).toContain(`const PYODIDE_VERSION = '${pkg.devDependencies.pyodide}';`);
});

test('кожен файл зі списку sw.js існує', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const list = sw.match(/const APP_FILES = \[([\s\S]*?)\];/)[1];
  for (const [, path] of list.matchAll(/'([^']+)'/g)) {
    expect(() => readFileSync(new URL(`../${path}`, import.meta.url)), path).not.toThrow();
  }
});

test('підказка «Додай на головний екран» — лише на iPad і до «Зрозуміло»', async ({ page }, testInfo) => {
  await page.goto('./#/');
  const hint = page.locator('.home-hint');
  if (testInfo.project.name !== 'iPad-WebKit') {
    await expect(page.locator('.map__title')).toBeVisible();
    await expect(hint).toHaveCount(0);
    return;
  }
  await expect(hint).toContainText('На екран "Додому"');
  await hint.getByRole('button', { name: 'Зрозуміло' }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.map__title')).toBeVisible();
  await expect(hint).toHaveCount(0);
});
