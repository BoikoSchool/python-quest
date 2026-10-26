// «Як це працює»: пояснення теми з прикладом, який можна запустити й змінити; підказки по одній.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers.js';

const readMission = (id) => JSON.parse(readFileSync(new URL(`../missions/${id}.json`, import.meta.url), 'utf8'));

/** Замінює код прикладу в блоці «Як це працює». */
async function setExampleCode(page, code) {
  await page.evaluate(async (text) => {
    const { EditorView } = await import(new URL('vendor/codemirror.js', document.baseURI).href);
    const view = EditorView.findFromDOM(document.querySelector('.learn .cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, code);
}

test('приклад запускається кнопкою «Спробувати», його можна змінити, а блок — згорнути', async ({ page }) => {
  await openApp(page, '#/m/ride-height');
  const learn = page.locator('details.learn');
  await expect(learn).toHaveAttribute('open', '');
  await expect(learn.locator('summary')).toContainText('Як це працює');
  await expect(learn.locator('.learn__indent')).toContainText('Відступи');

  const tryButton = page.getByRole('button', { name: 'Спробувати приклад' });
  await tryButton.click();
  await expect(learn.locator('.console')).toHaveText(/Можна плавати самому!/);
  // Результат прикладу — під прикладом, а не в «Результаті» місії.
  await expect(page.locator('.output .output__empty')).toBeVisible();

  await page.getByLabel('Вхідні дані для прикладу').fill('5');
  await tryButton.click();
  await expect(learn.locator('.console')).toHaveText(/Плаваємо з дорослими\./);

  await setExampleCode(page, 'print("Мій приклад")\nprint(x)\n');
  await tryButton.click();
  await expect(learn.locator('.console')).toHaveText(/Мій приклад/);
  await expect(learn.locator('.problem__title')).toHaveText('Помилка в рядку 2');
  await expect(page.locator('.learn .cm-errorLine')).toHaveText('print(x)');
  await expect(page.locator('.work .cm-errorLine')).toHaveCount(0);

  await learn.locator('summary').click();
  await expect(learn).not.toHaveAttribute('open', '');
});

test('підказки відкриваються по одній', async ({ page }) => {
  const { hints } = readMission('eco-grams');
  await openApp(page, '#/m/eco-grams');
  const list = page.locator('.hints__list li');
  await expect(list).toHaveCount(0);

  await page.getByRole('button', { name: 'Не виходить? Підказка' }).click();
  await expect(list).toHaveText([hints[0]]);
  const more = page.getByRole('button', { name: `Ще підказка (2 з ${hints.length})` });
  await more.click();
  await page.getByRole('button', { name: `Ще підказка (3 з ${hints.length})` }).click();
  await expect(list).toHaveText(hints);
  await expect(page.locator('.hints button')).toBeHidden();
});

test('блок «Як це працює» пам\'ятає, що його згорнули; у виконаній місії він згорнутий одразу', async ({ page }) => {
  await page.goto('./#/m/ride-height');
  const learn = page.locator('details.learn');
  await expect(learn).toHaveAttribute('open', '');
  await learn.locator('summary').click();
  await expect(learn).not.toHaveAttribute('open', '');
  await page.reload();
  await expect(learn).toBeAttached();
  await expect(learn).not.toHaveAttribute('open', '');

  await learn.locator('summary').click();
  await page.reload();
  await expect(learn).toHaveAttribute('open', '');

  // Виконана місія — блок згорнутий, поки учень сам його не розгорне.
  await page.evaluate(() => localStorage.setItem('pyquest:v1', JSON.stringify({
    missions: { 'eco-grams': { status: 'done', code: 'print(1)', updatedAt: 1 } },
    sandbox: { code: '', stdin: '' },
    settings: {},
  })));
  await page.goto('./#/m/eco-grams');
  await page.reload();
  await expect(learn).toBeAttached();
  await expect(learn).not.toHaveAttribute('open', '');
  await learn.locator('summary').click();
  await page.reload();
  await expect(learn).toHaveAttribute('open', '');
});
