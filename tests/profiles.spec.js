// Профілі учнів на спільному планшеті: «Хто ти?», окремий прогрес, «Змінити учня»,
// перенесення старого прогресу й видалення учня.

import { expect, test } from './fixtures.js';
import { setCode } from './helpers.js';

test.use({ student: false });

const PROFILES = 'pyquest:v1:profiles';
const OUTBOX = 'pyquest:v1:outbox';
const profileKey = (id) => `pyquest:v1:profile:${id}`;

const whoTitle = (page) => page.getByRole('heading', { name: 'Хто ти?' });
const nameField = (page) => page.getByLabel('Ім\'я та прізвище');
const classField = (page) => page.getByLabel('Клас', { exact: true });
const classButtons = (page) => page.locator('.who__choice--class');
const studentButtons = (page) => page.locator('.who__grid--names .who__choice');

/** Новий учень через форму «Я тут уперше». */
async function createStudent(page, name, className) {
  const firstTime = page.getByRole('button', { name: 'Я тут уперше' });
  if (await firstTime.isVisible()) await firstTime.click();
  await nameField(page).fill(name);
  await classField(page).fill(className);
  await page.getByRole('button', { name: 'Почати' }).click();
}

/** Кладе на «планшет» учнів (і, за потреби, інші ключі) та обирає поточного. */
async function seed(page, list, { current = null, extra = {} } = {}) {
  await page.goto('./');
  await page.evaluate(([profiles, list, current, extra]) => {
    localStorage.setItem(profiles, JSON.stringify({ list }));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, JSON.stringify(value));
    if (current) sessionStorage.setItem('pyquest:v1:current', current);
  }, [PROFILES, list, current, extra]);
  await page.reload();
}

const read = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

const student = (id, name, className) => ({ id, name, className, createdAt: 1 });

test('перше відкриття — форма; ім\'я й клас перевіряються; далі карта й учень угорі', async ({ page }) => {
  await page.goto('./#/');
  await expect(whoTitle(page)).toBeVisible();
  await expect(page.locator('.topbar__nav')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Я тут уперше' })).toHaveCount(0); // одразу форма

  await createStudent(page, 'олена', '6а');
  await expect(page.locator('.who__error')).toHaveText('Напиши ім\'я та прізвище, наприклад: Олена Коваль.');
  await createStudent(page, 'олена   коваль', '   ');
  await expect(page.locator('.who__error')).toHaveText('Напиши свій клас, наприклад: 6-А.');
  await createStudent(page, 'олена   коваль', '6а'); // короткий запис стає «6-А»

  await expect(page.locator('.map__title')).toHaveText('Карта місій');
  await expect(page.locator('#student')).toContainText('Олена Коваль');
  await expect(page.locator('#student')).toContainText('6-А');
  await expect(page.locator('.topbar__nav')).toBeVisible();
});

test('спершу класи планшета, потім учні класу; «Я тут уперше» підставляє клас', async ({ page }) => {
  await seed(page, [
    student('a', 'Олена Коваль', '6-А'),
    student('b', 'Андрій Мельник', '10-А'),
    student('c', 'Богдан Ткач', '6-А'),
    student('d', 'Ірина Лисенко', '5-Б'),
    student('e', 'Ярина Біла', '9 Харків'),
    student('f', 'Тарас Бойко', '6'),
  ]);
  // Клас — як його написали; числа впорядковуються як числа.
  await expect(classButtons(page)).toHaveText(['5-Б', '6', '6-А', '9 Харків', '10-А']);

  await classButtons(page).filter({ hasText: '6-А' }).click();
  await expect(studentButtons(page)).toHaveText(['Богдан Ткач', 'Олена Коваль']);

  await page.getByRole('button', { name: 'Я тут уперше' }).click();
  await expect(classField(page)).toHaveValue('6-А');
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: '← Інший клас' }).click();
  await expect(classButtons(page)).toHaveCount(5);

  await classButtons(page).filter({ hasText: '6-А' }).click();
  await studentButtons(page).filter({ hasText: 'Олена Коваль' }).click();
  await expect(page.locator('.map__title')).toBeVisible();
  await expect(page.locator('#student')).toContainText('Олена Коваль');
});

test('у кожного учня свій код; «Змінити учня»; оновлення не питає, нове відкриття — питає', async ({ page, context }) => {
  await page.goto('./#/sandbox');
  await createStudent(page, 'Олена Коваль', '6-А');
  await expect(page.locator('.work .cm-content')).toBeVisible();
  await setCode(page, 'print("Олена")\n');
  await page.waitForTimeout(800); // автозбереження через 500 мс

  await page.reload();
  await expect(page.locator('.work .cm-content')).toContainText('print("Олена")');
  await expect(whoTitle(page)).toHaveCount(0);

  await page.getByRole('button', { name: /Змінити учня/ }).click();
  await expect(whoTitle(page)).toBeVisible();
  await createStudent(page, 'Богдан Ткач', '9   Харків');
  await expect(page.locator('.work .cm-content')).toBeVisible();
  await expect(page.locator('.work .cm-content')).not.toContainText('Олена');
  await expect(page.locator('#student')).toContainText('9 Харків');

  // Нове відкриття сайту (інша вкладка) — знову «Хто ти?».
  const other = await context.newPage();
  await other.goto('./#/sandbox');
  await expect(classButtons(other)).toHaveText(['6-А', '9 Харків']);
  await classButtons(other).filter({ hasText: '6-А' }).click();
  await studentButtons(other).filter({ hasText: 'Олена Коваль' }).click();
  await expect(other.locator('.work .cm-content')).toContainText('print("Олена")');
});

test('прогрес з часів до профілів переходить до першого учня', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('pyquest:v1', JSON.stringify({
    missions: { 'radio-hello': { status: 'done', code: 'print(1)', updatedAt: 1 } },
    sandbox: { code: '', stdin: '' },
    settings: {},
  })));
  await page.goto('./#/');
  await page.reload();
  await expect(page.locator('.who')).toContainText('Прогрес, який уже є на цьому планшеті, перейде до першого учня.');

  await createStudent(page, 'Олена Коваль', '6-А');
  await expect(page.locator('a[href="#/m/radio-hello"]')).toContainText('Виконано');
  expect(await page.evaluate(() => localStorage.getItem('pyquest:v1'))).toBeNull();

  await page.getByRole('button', { name: /Змінити учня/ }).click();
  await expect(page.locator('.who')).not.toContainText('Прогрес, який уже є');
  await createStudent(page, 'Богдан Ткач', '6-А');
  await expect(page.locator('a[href="#/m/radio-hello"]')).toContainText('Не почато');
});

test('видалення учня: лише після підтвердження, черга для вчителя лишається', async ({ page }) => {
  const outbox = [{ app: 'python-quest', uid: 'x', student: 'Богдан Ткач', missionId: 'radio-hello' }];
  await seed(page, [student('a', 'Олена Коваль', '6-А'), student('b', 'Богдан Ткач', '7-Б')], {
    current: 'a',
    extra: {
      [profileKey('a')]: { missions: {}, sandbox: { code: 'олена', stdin: '' }, settings: {} },
      [profileKey('b')]: { missions: {}, sandbox: { code: 'богдан', stdin: '' }, settings: {} },
      [OUTBOX]: outbox,
    },
  });
  await page.goto('./#/settings');
  const list = page.locator('.settings__students li');
  await expect(list).toHaveText(['6-А · Олена КовальВидалити', '7-Б · Богдан ТкачВидалити']);

  const deleteBohdan = page.getByRole('button', { name: 'Видалити учня Богдан Ткач, 7-Б' });
  page.once('dialog', (dialog) => dialog.dismiss());
  await deleteBohdan.click();
  await expect(list).toHaveCount(2);
  expect(await read(page, profileKey('b'))).not.toBeNull();

  page.once('dialog', (dialog) => dialog.accept());
  await deleteBohdan.click();
  await expect(page.locator('.settings__message--ok')).toHaveText('Учня Богдан Ткач видалено з цього планшета.');
  await expect(list).toHaveCount(1);
  expect(await read(page, profileKey('b'))).toBeNull();
  expect((await read(page, PROFILES)).list.map((p) => p.id)).toEqual(['a']);
  expect(await read(page, profileKey('a'))).not.toBeNull();
  expect(await read(page, OUTBOX)).toEqual(outbox);

  // Видалив себе — знову «Хто ти?», а на планшеті нікого: одразу форма.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Видалити учня Олена Коваль, 6-А' }).click();
  await expect(whoTitle(page)).toBeVisible();
  await expect(nameField(page)).toBeVisible();
  expect(await read(page, profileKey('a'))).toBeNull();
  expect(await read(page, OUTBOX)).toEqual(outbox);
});
