// Версії, які треба міняти разом: тег контейнера Playwright у CI і @playwright/test у package.json.
// Без браузера — лише читає файли, тож падає з зрозумілим поясненням ще до того, як щось зламається в CI.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('тег контейнера Playwright у CI збігається з @playwright/test у package.json', () => {
  const workflow = read('.github/workflows/pages.yml');
  const declared = JSON.parse(read('package.json')).devDependencies['@playwright/test'];
  const installed = JSON.parse(read('node_modules/@playwright/test/package.json')).version;

  const tag = workflow.match(/image:\s*mcr\.microsoft\.com\/playwright:v([\w.-]+?)-noble\b/)?.[1];
  expect(tag, 'у .github/workflows/pages.yml немає образу mcr.microsoft.com/playwright:v<версія>-noble').toBeTruthy();
  expect(declared, 'у package.json версія @playwright/test має бути точною, без ^ і ~').toMatch(/^\d+\.\d+\.\d+$/);
  expect(tag, `тег контейнера v${tag} ≠ @playwright/test ${declared} у package.json — зміни тег у pages.yml`).toBe(declared);
  expect(installed, `встановлено @playwright/test ${installed}, а в package.json ${declared} — запусти npm install`).toBe(declared);
});
