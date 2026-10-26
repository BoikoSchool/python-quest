// Спільні дії для тестів.

import { expect } from '@playwright/test';

/** Відкриває екран (наприклад '#/sandbox') і чекає, поки Python буде готовий. */
export async function openApp(page, hash = '#/') {
  await page.goto(`./${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-python', 'ready', { timeout: 90_000 });
}

/**
 * Замінює весь код у редакторі програми (не в прикладі «Як це працює») — як вставлення з буфера, без автовідступу.
 * Доступ до редактора беремо з того самого vendor/codemirror.js, що й сайт.
 */
export async function setCode(page, code) {
  await page.evaluate(async (text) => {
    const { EditorView } = await import(new URL('vendor/codemirror.js', document.baseURI).href);
    const view = EditorView.findFromDOM(document.querySelector('.work .cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, code);
}

export const runButton = (page) => page.getByRole('button', { name: 'Запустити програму' });
export const checkButton = (page) => page.getByRole('button', { name: 'Перевірити місію' });
export const stdinField = (page) => page.getByLabel(/Кожне значення — з нового рядка/);
