// Спільний test для всіх spec-файлів: на кожній сторінці вже обрано учня «Тестовий Учень, 6-А»,
// тож тести не зупиняються на екрані «Хто ти?».
//
// Тести самих профілів вимикають це: test.use({ student: false }).
//
// Здана в тесті місія не повинна потрапити в справжню таблицю вчителя. Тестовий сервер віддає
// порожній js/config.js, а тут — запобіжник і для тестів проти живого сайту (PQ_BASE_URL):
// fetch на адреси Google обривається просто в сторінці. Самого лише context.route мало:
// у WebKit запити сторінки, якою керує Service Worker, повз нього проходять.

import { test as base, expect } from '@playwright/test';

export const STUDENT = { id: 'test-student', name: 'Тестовий Учень', className: '6-А' };
export const PROFILE_KEY = `pyquest:v1:profile:${STUDENT.id}`;

/** Створює учня STUDENT і обирає його — якщо на «планшеті» ще немає жодного учня. */
export async function addStudent(page) {
  await page.addInitScript((student) => {
    try {
      if (localStorage.getItem('pyquest:v1:profiles') !== null) return;
      localStorage.setItem('pyquest:v1:profiles', JSON.stringify({ list: [{ ...student, createdAt: 0 }] }));
      sessionStorage.setItem('pyquest:v1:current', student.id);
    } catch {
      // about:blank і подібні сторінки без сховища
    }
  }, STUDENT);
}

const GOOGLE = /^https:\/\/script\.google(usercontent)?\.com\//;

/** Обриває запити до Google у цьому контексті браузера. */
export async function blockGoogle(context) {
  await context.route(GOOGLE, (route) => route.abort('blockedbyclient'));
  await context.addInitScript((pattern) => {
    const google = new RegExp(pattern);
    const realFetch = window.fetch;
    window.fetch = (input, init) => (google.test(String(input?.url ?? input))
      ? Promise.reject(new TypeError('Запити до Google у тестах заблоковано'))
      : realFetch.call(window, input, init));
  }, GOOGLE.source);
}

export const test = base.extend({
  student: [true, { option: true }],
  context: async ({ context }, use) => {
    await blockGoogle(context);
    await use(context);
  },
  page: async ({ page, student }, use) => {
    if (student) await addStudent(page);
    await use(page);
  },
});

export { expect };
