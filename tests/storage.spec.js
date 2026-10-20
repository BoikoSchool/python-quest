// Збереження прогресу: код і статус місії лишаються після перезавантаження сторінки.

import { expect, test } from '@playwright/test';
import { checkButton, openApp, setCode } from './helpers.js';

test('код місії зберігається, а на карті вона «в роботі»', async ({ page }) => {
  await openApp(page, '#/m/excursion-price');
  await setCode(page, 'price = int(input())\ncount = int(input())\n# моя чернетка\n');
  await page.waitForTimeout(800); // автозбереження спрацьовує через 500 мс
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('# моя чернетка');

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
