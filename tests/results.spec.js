// Результати для вчителя: запис про зараховану місію, черга без інтернету, вимкнене надсилання.
//
// Справжньої таблиці тут немає: js/config.js підміняємо адресою-заглушкою, а запити на неї
// перехоплює сам тест. Service Worker вимкнено, щоб Playwright бачив усі запити сторінки.

import { readFileSync } from 'node:fs';
import { expect, STUDENT, test } from './fixtures.js';
import { checkButton, openApp, setCode } from './helpers.js';

test.use({ serviceWorkers: 'block' });

const TEACHER_URL = 'https://results.example.test/exec';
const OUTBOX = 'pyquest:v1:outbox';
const mission = JSON.parse(readFileSync(new URL('../missions/radio-hello.json', import.meta.url), 'utf8'));
const SOLUTION = 'print("Доброго ранку, школо!")\nprint("В ефірі шкільне радіо.")\n';

const readOutbox = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), OUTBOX);
const sentLine = (page) => page.locator('.success__sent');

/**
 * Вмикає надсилання на адресу-заглушку. Повертає «таблицю вчителя»:
 * posts — що прийшло; online — чи є інтернет (false — запит обривається).
 */
async function connectTeacher(page) {
  const teacher = { posts: [], online: true };
  await page.route('**/js/config.js', (route) => route.fulfill({
    contentType: 'text/javascript; charset=utf-8',
    body: `export const RESULTS_URL = '${TEACHER_URL}';\n`,
  }));
  await page.route(TEACHER_URL, (route) => {
    if (!teacher.online) return route.abort('internetdisconnected');
    const request = route.request();
    teacher.posts.push({
      method: request.method(),
      contentType: request.headers()['content-type'],
      body: JSON.parse(request.postData()),
    });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  return teacher;
}

/** Здає «Шкільне радіо»: правильний код і правильна відповідь. */
async function solveRadio(page) {
  await setCode(page, SOLUTION);
  await checkButton(page).click();
  await page.getByLabel(mission.question.options[mission.question.answer]).check();
  await page.getByRole('button', { name: 'Відповісти' }).click();
  await expect(page.getByText('Місію виконано!')).toBeVisible();
}

test('зарахована місія — запис учителю; повторне проходження не надсилається', async ({ page }) => {
  const teacher = await connectTeacher(page);
  await openApp(page, '#/m/radio-hello');
  await page.getByRole('button', { name: 'Не виходить? Підказка' }).click();
  await checkButton(page).click(); // шаблон не проходить — це перша перевірка
  await expect(page.locator('.verdict--bad')).toBeVisible();
  await solveRadio(page);

  await expect(sentLine(page)).toHaveText('✔ Результат надіслано вчителю');
  expect(teacher.posts).toHaveLength(1);
  const [post] = teacher.posts;
  expect(post.method).toBe('POST');
  expect(post.contentType).toMatch(/^text\/plain/);
  expect(post.body).toMatchObject({
    app: 'python-quest',
    student: STUDENT.name,
    className: STUDENT.className,
    missionId: 'radio-hello',
    missionTitle: mission.title,
    checks: 2,
    hints: 1,
    minutes: 0,
    code: SOLUTION,
  });
  expect(Date.parse(post.body.time)).not.toBeNaN();
  expect(await readOutbox(page)).toBeNull();

  // Відкрита раніше підказка лишається відкритою.
  await page.reload();
  await expect(page.locator('.hints__list li')).toHaveCount(1);

  await expect(page.locator('html')).toHaveAttribute('data-python', 'ready', { timeout: 90_000 });
  await solveRadio(page);
  await page.waitForTimeout(500);
  await expect(sentLine(page)).toHaveText('');
  expect(teacher.posts).toHaveLength(1);
});

test('без інтернету запис чекає в черзі й іде сам, коли мережа з\'явилась', async ({ page }) => {
  const teacher = await connectTeacher(page);
  teacher.online = false;
  await openApp(page, '#/m/radio-hello');
  await solveRadio(page);

  await expect(sentLine(page)).toHaveText('Результат надішлеться, коли з\'явиться інтернет');
  expect(await readOutbox(page)).toHaveLength(1);
  expect(teacher.posts).toHaveLength(0);

  teacher.online = true;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => teacher.posts.length).toBe(1);
  expect(teacher.posts[0].body).toMatchObject({ student: STUDENT.name, missionId: 'radio-hello', checks: 1, hints: 0 });
  await expect.poll(() => readOutbox(page)).toBeNull();
});

test('черга з минулого разу відправляється під час наступного відкриття сайту', async ({ page }) => {
  const teacher = await connectTeacher(page);
  teacher.online = false;
  await page.goto('./#/');
  const waiting = [
    { app: 'python-quest', uid: '1', student: 'Олена Коваль', className: '6-А', missionId: 'radio-hello', code: '' },
    { app: 'python-quest', uid: '2', student: 'Олена Коваль', className: '6-А', missionId: 'eco-grams', code: '' },
  ];
  await page.evaluate(([key, list]) => localStorage.setItem(key, JSON.stringify(list)), [OUTBOX, waiting]);

  teacher.online = true;
  await page.reload();
  await expect.poll(() => teacher.posts.map((post) => post.body.uid)).toEqual(['1', '2']);
  await expect.poll(() => readOutbox(page)).toBeNull();
});

test('порожній config.js — нічого не надсилається й не з\'являється', async ({ page, baseURL }) => {
  const outside = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(new URL(baseURL).origin)) outside.push(request.url());
  });
  await openApp(page, '#/m/radio-hello');
  await solveRadio(page);
  await page.waitForTimeout(500);
  await expect(sentLine(page)).toHaveText('');
  expect(await readOutbox(page)).toBeNull();
  expect(outside).toEqual([]);
  await page.goto('./#/');
  await expect(page.locator('.map__note')).not.toContainText('вчитель');
});
