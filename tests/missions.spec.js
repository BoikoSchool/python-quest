// Перевірка місій: шаблон не зараховується, еталонний розв'язок — зараховується,
// відкриті й приховані тести показують те, що належить за ТЗ.
//
// Еталонні розв'язки лежать лише локально (missions/solutions/ у .gitignore),
// тому там, де їх немає (CI), тести з розв'язками пропускаються.

import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { checkButton, openApp, setCode } from './helpers.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const index = readJson('../missions/index.json');
const missionIds = index.topics.flatMap((topic) => topic.missions);

for (const id of missionIds) {
  const mission = readJson(`../missions/${id}.json`);
  const solutionFile = new URL(`../missions/solutions/${id}.py`, import.meta.url);

  test(`${id}: стартовий шаблон не зараховується`, async ({ page }) => {
    await openApp(page, `#/m/${id}`);
    // Над завданням — відкритий блок «Як це працює».
    await expect(page.locator('details.learn')).toHaveAttribute('open', '');
    await expect(page.locator('.learn__title')).toHaveText(mission.learn.title);
    await checkButton(page).click();
    await expect(page.locator('.verdict--bad')).toBeVisible();
    await expect(page.getByText('Місію виконано!')).toHaveCount(0);
  });

  test(`${id}: еталонний розв'язок зараховується`, async ({ page }) => {
    test.skip(!existsSync(solutionFile), 'Еталонних розв\'язків тут немає (так у CI)');
    await openApp(page, `#/m/${id}`);
    await setCode(page, readFileSync(solutionFile, 'utf8'));
    await checkButton(page).click();
    await expect(page.locator('.verdict--ok')).toHaveText(`Усі тести пройдено: ${mission.tests.length} з ${mission.tests.length}.`);
    if (mission.question) {
      await page.getByLabel(mission.question.options[mission.question.answer], { exact: true }).check();
      await page.getByRole('button', { name: 'Відповісти' }).click();
    }
    await expect(page.getByText('Місію виконано!')).toBeVisible();

    await page.goto('./#/');
    await expect(page.locator(`a[href="#/m/${id}"]`)).toContainText('Виконано');
  });
}

test('відкритий тест показує вхід, очікуваний і отриманий вивід', async ({ page }) => {
  await openApp(page, '#/m/eco-grams');
  await setCode(page, 'kg = int(input())\nprint(kg * 100)\n');
  await checkButton(page).click();
  await expect(page.locator('.verdict--bad')).toHaveText('Пройдено 1 з 4 тестів.');
  const failure = page.locator('.failure');
  await expect(failure).toContainText('Тест 1');
  await expect(failure).toContainText('Очікувалось');
  await expect(failure).toContainText('3000');
  await expect(failure).toContainText('Твоя програма вивела');
  await expect(failure).toContainText('300');
});

test('прихований тест — лише повідомлення, без вхідних даних', async ({ page }) => {
  await openApp(page, '#/m/eco-grams');
  // Проходить відкриті тести (3 → 3000, 0 → 0), але не приховані.
  await setCode(page, 'kg = int(input())\nprint(3000 if kg == 3 else 0)\n');
  await checkButton(page).click();
  await expect(page.locator('.verdict--bad')).toHaveText('Пройдено 2 з 4 тестів.');
  await expect(page.getByText('Прихований тест не пройдено.')).toBeVisible();
  await expect(page.locator('.failure')).toHaveCount(0);
  await expect(page.getByText('12000')).toHaveCount(0);
});

test('неправильна відповідь на запитання не зараховує місію', async ({ page }) => {
  await openApp(page, '#/m/eco-grams');
  await setCode(page, 'kg = int(input())\nprint(kg * 1000)\n');
  await checkButton(page).click();
  await page.getByLabel('Щоб число стало дробовим').check();
  await page.getByRole('button', { name: 'Відповісти' }).click();
  await expect(page.getByText('Ні, подумай ще раз.')).toBeVisible();
  await expect(page.getByText('Місію виконано!')).toHaveCount(0);
});
