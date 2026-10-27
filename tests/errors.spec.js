// Словник помилок (docs/SPEC.md, п. 3.4): пояснення українською, номер рядка й оригінал Python.

import { expect, test } from './fixtures.js';
import { openApp, runButton, setCode } from './helpers.js';

const cases = [
  {
    type: 'SyntaxError',
    code: 'x = 1\nprint("Привіт"\n',
    line: 2,
    explanation: 'У рядку 2 порушено правила запису. Перевір дужки, лапки та двокрапку.',
  },
  {
    type: 'IndentationError',
    code: 'if True:\nprint(1)\n',
    line: 2,
    explanation: 'Відступи не збігаються. Усередині блоку однакові відступи — 4 пробіли.',
  },
  {
    type: 'NameError',
    code: 'x = 1\nprint(y)\n',
    line: 2,
    explanation: 'Python не знає імені «y». Можливо, змінна ще не створена або є одрук.',
  },
  {
    type: 'TypeError',
    code: 'age = 12\nprint("Мені " + age)\n',
    line: 2,
    explanation: 'Операцію виконано над несумісними типами, наприклад рядок + число.',
  },
  {
    type: 'ValueError',
    code: 'n = int("абв")\n',
    line: 1,
    explanation: 'Не вдалося перетворити значення.',
  },
  {
    type: 'ZeroDivisionError',
    code: 'a = 5\nb = 0\nprint(a / b)\n',
    line: 3,
    explanation: 'Ділення на нуль.',
  },
];

for (const { type, code, line, explanation } of cases) {
  test(`${type}: пояснення українською з номером рядка`, async ({ page }) => {
    await openApp(page, '#/sandbox');
    await setCode(page, code);
    await runButton(page).click();
    const problem = page.locator('.problem');
    await expect(problem.locator('.problem__title')).toHaveText(`Помилка в рядку ${line}`);
    await expect(problem.locator('.problem__text')).toContainText(explanation);
    await expect(problem.locator('.problem__original')).toContainText(`${type}: `);
    await expect(page.locator('.cm-errorLine')).toHaveCount(1);
  });
}
