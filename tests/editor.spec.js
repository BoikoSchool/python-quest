// Редактор: «розумні» лапки й тире, які вставляє iPad, замінюються на звичайні.

import { expect, test } from '@playwright/test';
import { openApp, runButton, setCode } from './helpers.js';

/** Текст у редакторі — з того самого vendor/codemirror.js, що й сайт. */
async function editorText(page) {
  return page.evaluate(async () => {
    const { EditorView } = await import(new URL('vendor/codemirror.js', document.baseURI).href);
    return EditorView.findFromDOM(document.querySelector('.work .cm-editor')).state.doc.toString();
  });
}

test('набрані “ ” стають звичайними лапками, і програма працює', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await page.locator('.cm-content').click();
  await page.keyboard.type('print(“Привіт”)');
  expect(await editorText(page)).toBe('print("Привіт")');
  await runButton(page).click();
  await expect(page.locator('.console')).toHaveText('Привіт');
});

test('вставлений текст з ‘ ’ і тире теж виправляється, а « » лишаються', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await page.evaluate(async () => {
    const { EditorView } = await import(new URL('vendor/codemirror.js', document.baseURI).href);
    const view = EditorView.findFromDOM(document.querySelector('.work .cm-editor'));
    view.dispatch({ changes: { from: 0, insert: 'print(‘«Так»’, 5 – 2 — 1)' }, userEvent: 'input.paste' });
  });
  expect(await editorText(page)).toBe('print(\'«Так»\', 5 - 2 - 1)');
});

test('код, завантажений програмно, не змінюється', async ({ page }) => {
  await openApp(page, '#/sandbox');
  await setCode(page, 'print("“лапки” всередині рядка")\n');
  expect(await editorText(page)).toBe('print("“лапки” всередині рядка")\n');
});
