// apps-script/Code.gs — приймач результатів у Google Таблиці. Без браузера і без Google:
// файл виконується в node:vm з простими заглушками SpreadsheetApp, LockService, ContentService.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, test } from '@playwright/test';

const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

/** Аркуш, як його бачить Apps Script. Апостроф на початку тексту таблиця не показує й не повертає. */
class FakeSheet {
  constructor() {
    this.rows = []; // те, що записав скрипт, разом з апострофами
  }

  getLastRow() {
    return this.rows.length;
  }

  appendRow(row) {
    this.rows.push([...row]);
  }

  getRange(row, column, rowCount, columnCount) {
    const sheet = this;
    return {
      getValues: () => sheet.rows.slice(row - 1, row - 1 + rowCount)
        .map((r) => r.slice(column - 1, column - 1 + columnCount)
          .map((value) => (typeof value === 'string' ? value.replace(/^'/, '') : value ?? ''))),
      setValues(values) {
        values.forEach((r, i) => {
          sheet.rows[row - 1 + i] ??= [];
          r.forEach((value, j) => { sheet.rows[row - 1 + i][column - 1 + j] = value; });
        });
        return this;
      },
      setFontWeight() {
        return this;
      },
    };
  }

  setFrozenRows() {}
  setFrozenColumns() {}

  clearContents() {
    this.rows = [];
  }
}

function loadScript() {
  const sheets = new Map();
  const lock = { waits: 0, releases: 0 };
  const context = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets.get(name) ?? null,
        insertSheet: (name) => {
          sheets.set(name, new FakeSheet());
          return sheets.get(name);
        },
        getSpreadsheetTimeZone: () => 'Europe/Kyiv',
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => { lock.waits += 1; }, releaseLock: () => { lock.releases += 1; } }),
    },
    ContentService: { createTextOutput: (text) => ({ text }) },
    Utilities: {
      formatDate: (date, timeZone) => date.toLocaleDateString('uk-UA', { timeZone, day: '2-digit', month: '2-digit' }),
    },
  });
  vm.runInContext(code, context);
  const post = (record) => context.doPost({ postData: { contents: JSON.stringify(record) } }).text;
  return { context, sheets, lock, post };
}

const record = (fields = {}) => ({
  app: 'python-quest',
  time: '2026-10-27T09:00:00.000Z',
  student: 'Олена Коваль',
  className: '6-А',
  missionId: 'radio-hello',
  missionTitle: 'Шкільне радіо',
  checks: 2,
  hints: 1,
  minutes: 7,
  code: 'print("Привіт")\n',
  uid: 'abc',
  ...fields,
});

test('doGet відповідає, що приймач працює', () => {
  const { context } = loadScript();
  expect(context.doGet().text).toBe('Python Quest: приймач результатів працює.');
});

test('запис потрапляє в «Журнал» із заголовками, а «Зведення» — з ✔ і датою', () => {
  const { sheets, lock, post } = loadScript();
  expect(post(record())).toBe('ok');

  const log = sheets.get('Журнал').rows;
  expect(log[0]).toEqual(['Час виконання', 'Отримано', 'Учень', 'Клас', 'ID місії', 'Місія', 'Перевірок', 'Підказок', 'Хвилин', 'Код']);
  expect(log).toHaveLength(2);
  expect(log[1].slice(2)).toEqual(['Олена Коваль', '6-А', 'radio-hello', 'Шкільне радіо', 2, 1, 7, 'print("Привіт")\n']);
  expect(log[1][0].toISOString()).toBe('2026-10-27T09:00:00.000Z');

  expect(sheets.get('Зведення').rows).toEqual([
    ['Клас', 'Учень', 'Виконано', 'Шкільне радіо'],
    ['6-А', 'Олена Коваль', 1, '✔ 27.10'],
  ]);
  expect(lock).toEqual({ waits: 1, releases: 1 });
});

test('той самий учень і місія вдруге не додаються, навіть з іншим регістром і пробілами', () => {
  const { sheets, post } = loadScript();
  expect(post(record())).toBe('ok');
  expect(post(record({ student: '  олена   КОВАЛЬ ', className: '6-а', code: 'інший код', uid: 'def' }))).toBe('вже є');
  expect(sheets.get('Журнал').rows).toHaveLength(2);
  // Інша місія того ж учня — новий рядок.
  expect(post(record({ missionId: 'eco-grams', missionTitle: 'Екомоніторинг' }))).toBe('ok');
  expect(sheets.get('Журнал').rows).toHaveLength(3);
});

test('текст, схожий на формулу, записується як звичайний текст', () => {
  const { sheets, post } = loadScript();
  post(record({ student: '=HYPERLINK("http://x") Учень', missionTitle: '+1', code: '-1\nprint(1)' }));
  const row = sheets.get('Журнал').rows[1];
  expect(row[2]).toBe('\'=HYPERLINK("http://x") Учень');
  expect(row[5]).toBe('\'+1');
  expect(row[9]).toBe('\'-1\nprint(1)');
  expect(sheets.get('Зведення').rows[1][1]).toBe('\'=HYPERLINK("http://x") Учень');
});

test('чужі й зіпсовані записи не потрапляють у таблицю', () => {
  const { context, sheets, post } = loadScript();
  expect(post({ hello: 'world' })).toMatch(/^помилка/);
  expect(post(record({ missionId: '../../evil' }))).toMatch(/^помилка/);
  expect(post(record({ student: '   ' }))).toMatch(/^помилка/);
  expect(context.doPost({ postData: { contents: '{ не json' } }).text).toMatch(/^помилка/);
  expect(sheets.size).toBe(0);
});

test('«Зведення»: учні за класом і абеткою, місії в порядку появи', () => {
  const { sheets, post } = loadScript();
  post(record({ student: 'Ярема Бойко', className: '10-А' }));
  post(record({ student: 'Олена Коваль', className: '6-А', missionId: 'eco-grams', missionTitle: 'Екомоніторинг',
    time: '2026-10-28T09:00:00.000Z' }));
  post(record({ student: 'Андрій Ткач', className: '6-А' }));
  post(record({ student: 'Олена Коваль', className: '6-А' }));

  expect(sheets.get('Зведення').rows).toEqual([
    ['Клас', 'Учень', 'Виконано', 'Шкільне радіо', 'Екомоніторинг'],
    ['6-А', 'Андрій Ткач', 1, '✔ 27.10', ''],
    ['6-А', 'Олена Коваль', 2, '✔ 27.10', '✔ 28.10'],
    ['10-А', 'Ярема Бойко', 1, '✔ 27.10', ''],
  ]);
});
