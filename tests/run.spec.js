// Запуск коду: Python готується, виконує програму, зупиняє нескінченний цикл,
// бере вхідні дані з поля й зрозуміло пояснює помилки.

import { expect, test } from './fixtures.js';
import { openApp, runButton, setCode, stdinField } from './helpers.js';

test('print("Привіт"), набраний з клавіатури, виводить «Привіт»', async ({ page }, testInfo) => {
  await page.goto('./#/sandbox');
  await expect(page.getByText('Готуємо Python…')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-python', 'ready', { timeout: 90_000 });
  const readyMs = await page.locator('html').getAttribute('data-python-ready-ms');
  console.log(`[${testInfo.project.name}] Python готовий за ${readyMs} мс`);
  await expect(page.locator('#py-progress')).toBeHidden();

  await page.locator('.cm-content').click();
  await page.keyboard.type('print("Привіт")');
  await runButton(page).click();
  await expect(page.locator('.console')).toHaveText('Привіт');
  await expect(page.locator('.output__time')).toContainText('Виконано за');
});

test('while True: pass зупиняється приблизно за 5 с, а наступний запуск працює', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await setCode(page, 'while True:\n    pass\n');
  const started = Date.now();
  await runButton(page).click();
  await expect(page.getByText('Програма працює надто довго — можливо, цикл не закінчується.'))
    .toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThan(4_500);
  expect(elapsed).toBeLessThan(10_000);

  // Worker перезапустився — наступна програма працює.
  await setCode(page, 'print(2 + 2)\n');
  await runButton(page).click();
  await expect(page.locator('.console')).toHaveText('4', { timeout: 90_000 });
});

test('нескінченний print зупиняється з поясненням, а не з\'їдає пам\'ять', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await setCode(page, 'while True:\n    print("ще")\n');
  await runButton(page).click();
  await expect(page.getByText('Програма виводить забагато тексту.', { exact: false })).toBeVisible();
});

test('вхідні дані з поля; коли їх бракує — пояснення українською з номером рядка', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await setCode(page, 'a = int(input("Перше: "))\nb = int(input("Друге: "))\nprint(a + b)\n');
  // Поле «Вхідні дані» розгортається, бо в коді є input(
  await expect(page.locator('details.stdin')).toHaveAttribute('open', '');

  await stdinField(page).fill('2\n3');
  await runButton(page).click();
  // У консолі видно підказки й прочитані значення, як у терміналі.
  await expect(page.locator('.console')).toHaveText(/Перше: 2\s*Друге: 3\s*5/);

  await stdinField(page).fill('2');
  await runButton(page).click();
  await expect(page.getByText('Помилка в рядку 2')).toBeVisible();
  await expect(page.getByText('Програма просить більше вхідних даних, ніж їх задано в полі «Вхідні дані».')).toBeVisible();
  await expect(page.getByText('EOFError: EOF when reading a line')).toBeVisible();
});

test('NameError показує номер рядка й підсвічує рядок у редакторі', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await setCode(page, 'x = 1\nprint(y)\n');
  // Без input( поле «Вхідні дані» згорнуте.
  await expect(page.locator('details.stdin')).not.toHaveAttribute('open', '');
  await runButton(page).click();
  await expect(page.getByText('Помилка в рядку 2')).toBeVisible();
  await expect(page.getByText("NameError: name 'y' is not defined")).toBeVisible();
  await expect(page.locator('.cm-errorLine')).toHaveText('print(y)');
});
