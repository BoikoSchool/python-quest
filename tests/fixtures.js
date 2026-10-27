// Спільний test для всіх spec-файлів: на кожній сторінці вже обрано учня «Тестовий Учень, 6-А»,
// тож тести не зупиняються на екрані «Хто ти?».
//
// Тести самих профілів вимикають це: test.use({ student: false }).

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

export const test = base.extend({
  student: [true, { option: true }],
  page: async ({ page, student }, use) => {
    if (student) await addStudent(page);
    await use(page);
  },
});

export { expect };
