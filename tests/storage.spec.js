// Збереження прогресу: код і статус місії лишаються після перезавантаження; експорт, імпорт і скидання.

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { checkButton, openApp, setCode } from './helpers.js';

test('код місії зберігається, а на карті вона «в роботі»', async ({ page }) => {
  await openApp(page, '#/m/excursion-price');
  await setCode(page, 'price = int(input())\ncount = int(input())\n# моя чернетка\n');
  await page.waitForTimeout(800); // автозбереження спрацьовує через 500 мс
  await page.reload();
  await expect(page.locator('.work .cm-content')).toContainText('# моя чернетка');

  await page.goto('./#/');
  await expect(page.locator('a[href="#/m/excursion-price"]')).toContainText('В роботі');
});

test('зарахована місія лишається «виконано» після перезавантаження', async ({ page }) => {
  await openApp(page, '#/m/radio-hello');
  await setCode(page, 'print("Доброго ранку, школо!")\nprint("В ефірі шкільне радіо.")\n');
  await checkButton(page).click();
  await page.getByLabel('Виводить текст на екран').check();
  await page.getByRole('button', { name: 'Відповісти' }).click();
  await expect(page.getByText('Місію виконано!')).toBeVisible();

  await page.reload();
  await expect(page.locator('.task .chip--done')).toBeVisible();
  await page.goto('./#/');
  await expect(page.locator('a[href="#/m/radio-hello"]')).toContainText('Виконано');
});

// ---------- Експорт, імпорт, скидання ----------

const KEY = 'pyquest:v1';

/** Кладе прогрес у localStorage і відкриває екран заново, щоб сайт його прочитав. */
async function seed(page, state, hash = '#/settings') {
  await page.goto('./#/');
  await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [KEY, state]);
  await page.goto(`./${hash}`);
  await page.reload();
}

const readState = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

const progressFile = (data) => ({
  name: 'python-quest-progress.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(data)),
});

async function importFile(page, file) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles(file);
}

test('експорт у файл і імпорт на «іншому пристрої» відновлюють прогрес', async ({ page, browser }) => {
  await seed(page, {
    missions: {
      'radio-hello': { status: 'done', code: 'print("радіо")\n', updatedAt: 1 },
      'eco-grams': { status: 'started', code: '# чернетка\n', updatedAt: 2 },
    },
    sandbox: { code: 'print(42)\n', stdin: '' },
    settings: {},
  });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Експортувати прогрес' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^python-quest-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved).toMatchObject({ app: 'python-quest', schema: 1 });
  await expect(page.locator('.settings__message--ok')).toContainText('Файл з прогресом збережено');

  // Інший пристрій — новий контекст браузера з порожнім сховищем.
  const other = await browser.newPage();
  await other.goto('./#/settings');
  await importFile(other, progressFile(saved));
  await expect(other.locator('.settings__message--ok')).toHaveText('Прогрес відновлено. Місій у файлі: 2.');

  await other.goto('./#/');
  await expect(other.locator('a[href="#/m/radio-hello"]')).toContainText('Виконано');
  await expect(other.locator('a[href="#/m/eco-grams"]')).toContainText('В роботі');
  const state = await readState(other);
  expect(state.missions['eco-grams'].code).toBe('# чернетка\n');
  expect(state.sandbox.code).toBe('print(42)\n');
  await other.close();
});

test('імпорт об\'єднує: виконана місія лишається виконаною, код береться новіший', async ({ page }) => {
  await seed(page, {
    missions: {
      'radio-hello': { status: 'done', code: 'старий код', updatedAt: 100 },
      'eco-grams': { status: 'started', code: 'новий код тут', updatedAt: 500 },
    },
    sandbox: { code: 'моя пісочниця', stdin: '' },
    settings: {},
  });
  await importFile(page, progressFile({
    app: 'python-quest',
    schema: 1,
    missions: {
      'radio-hello': { status: 'started', code: 'новіший код', updatedAt: 200 },
      'eco-grams': { status: 'done', code: 'давній код', updatedAt: 50 },
      'piggy-bank': { status: 'started', code: 'з файлу', updatedAt: 1 },
    },
    sandbox: { code: 'пісочниця з файлу', stdin: '' },
  }));
  await expect(page.locator('.settings__message--ok')).toHaveText('Прогрес відновлено. Місій у файлі: 3.');

  const state = await readState(page);
  expect(state.missions['radio-hello']).toMatchObject({ status: 'done', code: 'новіший код' });
  expect(state.missions['eco-grams']).toMatchObject({ status: 'done', code: 'новий код тут' });
  expect(state.missions['piggy-bank']).toMatchObject({ status: 'started', code: 'з файлу' });
  expect(state.sandbox.code).toBe('моя пісочниця');
});

test('чужий або битий файл — зрозуміле повідомлення, прогрес не змінюється', async ({ page }) => {
  const before = {
    missions: { 'radio-hello': { status: 'done', code: 'print(1)', updatedAt: 1 } },
    sandbox: { code: '', stdin: '' },
    settings: {},
  };
  await seed(page, before);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'зламаний.json', mimeType: 'application/json', buffer: Buffer.from('{ це не json'),
  });
  await expect(page.locator('.settings__message--bad')).toContainText('Не вдалося прочитати файл.');

  await importFile(page, progressFile({ hello: 'world' }));
  await expect(page.locator('.settings__message--bad')).toHaveText('Це не файл прогресу Python Quest.');

  expect(await readState(page)).toEqual(before);
});

test('«Скинути все» стирає прогрес лише після підтвердження', async ({ page }) => {
  await seed(page, {
    missions: { 'radio-hello': { status: 'done', code: 'print(1)', updatedAt: 1 } },
    sandbox: { code: 'x = 1', stdin: '' },
    settings: {},
  });
  const reset = page.getByRole('button', { name: 'Скинути все' });

  page.once('dialog', (dialog) => dialog.dismiss());
  await reset.click();
  await expect.poll(() => readState(page).then((s) => s.missions['radio-hello']?.status)).toBe('done');

  page.once('dialog', (dialog) => dialog.accept());
  await reset.click();
  await expect(page.locator('.settings__message--ok')).toHaveText('Усе скинуто. Можна починати спочатку.');
  expect(await readState(page)).toEqual({ missions: {}, sandbox: { code: '', stdin: '' }, settings: {} });

  await page.goto('./#/');
  await expect(page.locator('a[href="#/m/radio-hello"]')).toContainText('Не почато');
});
