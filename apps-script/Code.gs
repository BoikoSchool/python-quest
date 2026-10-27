// Python Quest — приймач результатів у Google Таблиці вчителя.
//
// Як підключити й як оновити — README, розділ «Результати в Google Таблиці (для вчителя)».
// Коротко: таблиця → Розширення → Apps Script → вставити цей файл → Розгорнути як вебзастосунок
// («Виконувати як: я», «Доступ: усі») → адресу …/exec вписати в js/config.js.
//
// Тренажер надсилає POST з JSON (Content-Type text/plain) про кожну зараховану місію:
//   { app: 'python-quest', time, student, className, missionId, missionTitle, checks, hints, minutes, code, uid }
//
// Аркуші створюються й оформлюються самі:
//   «Журнал»   — рядок на кожен запис. Той самий учень + клас + місія удруге не додається
//                (повторна відправка з черги планшета або та сама місія на іншому планшеті).
//                Код — в одному рядку моноширинним шрифтом; увесь код видно, якщо клацнути клітинку.
//   «Зведення» — учні × місії: ✔ і дата. Перебудовується після кожного нового запису.
// Меню «Python Quest → Оновити таблицю» заново оформлює обидва аркуші (наприклад, після оновлення скрипта).

const LOG_SHEET = 'Журнал';
const SUMMARY_SHEET = 'Зведення';
const LOG_HEADERS = ['Учень', 'Клас', 'Час виконання', 'Отримано', 'ID місії', 'Місія', 'Перевірок', 'Підказок', 'Хвилин', 'Код'];
const LOG_WIDTHS = [190, 60, 110, 110, 130, 160, 85, 80, 70, 360]; // ширина стовпців у пікселях
const COL = { student: 0, className: 1, time: 2, received: 3, missionId: 4, missionTitle: 5, code: 9 }; // з 0
const TIME_FORMAT = 'dd.MM HH:mm'; // 27.10 13:10
const CODE_FONT = 'Roboto Mono';
const ROW_HEIGHT = 21; // однакова висота рядків, хоч би який довгий код
const MAX_CELL_LENGTH = 50000; // більше в клітинку Google Таблиці не влазить
const LOCK_WAIT_MS = 20000;

/** Відкрий адресу вебзастосунку в браузері: якщо бачиш цей текст — усе працює. */
function doGet() {
  return ContentService.createTextOutput('Python Quest: приймач результатів працює.');
}

function doPost(e) {
  let record;
  try {
    record = parseRecord_(JSON.parse(e.postData.contents));
  } catch (error) {
    return reply_('помилка: ' + error.message);
  }
  // Кілька планшетів можуть надсилати одночасно — пишемо по черзі.
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    const added = appendToLog_(record);
    if (added) rebuildSummary();
    return reply_(added ? 'ok' : 'вже є');
  } finally {
    lock.releaseLock();
  }
}

/** Меню в таблиці. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Python Quest')
    .addItem('Оновити таблицю', 'refreshSheets')
    .addToUi();
}

/** Заново оформлює «Журнал» і перебудовує «Зведення». */
function refreshSheets() {
  const sheet = logSheet_();
  formatLog_(sheet, 2, sheet.getLastRow() - 1);
  rebuildSummary();
}

function reply_(text) {
  return ContentService.createTextOutput(text);
}

// ---------- Перевірка запису ----------

const oneLine_ = (value) => String(value).replace(/\s+/g, ' ').trim();

function text_(value, maxLength, field) {
  if (typeof value !== 'string' || oneLine_(value) === '') throw new Error('немає поля ' + field);
  return oneLine_(value).slice(0, maxLength);
}

function count_(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : '';
}

function parseRecord_(data) {
  if (!data || data.app !== 'python-quest') throw new Error('це не запис Python Quest');
  if (typeof data.missionId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(data.missionId)) {
    throw new Error('неправильний id місії');
  }
  const time = new Date(data.time);
  return {
    time: isNaN(time.getTime()) ? new Date() : time,
    student: text_(data.student, 60, 'student'),
    className: text_(data.className, 30, 'className'),
    missionId: data.missionId,
    missionTitle: typeof data.missionTitle === 'string' ? oneLine_(data.missionTitle).slice(0, 100) : data.missionId,
    checks: count_(data.checks),
    hints: count_(data.hints),
    minutes: count_(data.minutes),
    code: typeof data.code === 'string' ? data.code.slice(0, MAX_CELL_LENGTH - 1) : '',
  };
}

/**
 * Захист від формул: текст, що починається з = + - @ (або табуляції чи повернення каретки),
 * таблиця виконала б як формулу. Апостроф спереду робить його звичайним текстом (апостроф не видно).
 */
function safe_(text) {
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

/** Учень + клас + місія, без різниці у великих літерах. */
function key_(student, className, missionId) {
  const clean = (value) => oneLine_(value).replace(/^'/, '').toLowerCase();
  return [clean(student), clean(className), clean(missionId)].join('|');
}

// ---------- Аркуші ----------

function sheet_(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (headers && sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

/** «Журнал». Якщо стовпці стоять у старому порядку (попередня версія скрипта) — переставляє їх. */
function logSheet_() {
  const sheet = sheet_(LOG_SHEET, LOG_HEADERS);
  const width = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  if (header.join('|') === LOG_HEADERS.join('|')) return sheet;

  const last = sheet.getLastRow();
  const old = sheet.getRange(1, 1, last, width).getValues();
  const from = LOG_HEADERS.map((name) => header.indexOf(name));
  const rows = old.slice(1).map((row) => from.map((i) => {
    const value = i === -1 ? '' : row[i];
    return typeof value === 'string' ? safe_(value) : value; // апострофи таблиця не повертає — ставимо знову
  }));
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, LOG_HEADERS.length).setValues([LOG_HEADERS, ...rows]);
  formatLog_(sheet, 2, rows.length);
  return sheet;
}

/** Оформлення «Журналу»: ширина стовпців, заголовок, і рядки з fromRow (count штук). */
function formatLog_(sheet, fromRow, count) {
  LOG_WIDTHS.forEach((width, i) => sheet.setColumnWidth(i + 1, width));
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  if (count < 1) return;
  sheet.getRange(fromRow, COL.time + 1, count, 2).setNumberFormat(TIME_FORMAT);
  sheet.getRange(fromRow, COL.code + 1, count, 1)
    .setFontFamily(CODE_FONT)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setRowHeightsForced(fromRow, count, ROW_HEIGHT);
}

function logRows_() {
  const sheet = logSheet_();
  const last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
}

/** Додає запис у «Журнал». false — такий учень цю місію вже здавав. */
function appendToLog_(record) {
  const key = key_(record.student, record.className, record.missionId);
  const exists = logRows_().some((row) => key_(row[COL.student], row[COL.className], row[COL.missionId]) === key);
  if (exists) return false;
  const sheet = logSheet_();
  sheet.appendRow([
    safe_(record.student),
    safe_(record.className),
    record.time,
    new Date(),
    record.missionId,
    safe_(record.missionTitle),
    record.checks,
    record.hints,
    record.minutes,
    safe_(record.code),
  ]);
  formatLog_(sheet, sheet.getLastRow(), 1);
  return true;
}

/** Класи по порядку, числа як числа: 5-Б, 6, 9 Харків, 10-А. */
function compareClasses_(a, b) {
  return String(a).localeCompare(String(b), 'uk', { numeric: true });
}

/**
 * Перебудовує «Зведення» з «Журналу»: рядок — учень, стовпець — місія (у порядку, в якому
 * місії вперше з'явились у журналі), у клітинці — ✔ і дата виконання.
 */
function rebuildSummary() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const timeZone = book.getSpreadsheetTimeZone();
  const missions = new Map(); // id → назва
  const students = new Map(); // ключ → { className, name, done: Map(id → дата) }

  for (const row of logRows_()) {
    const missionId = String(row[COL.missionId]);
    if (!missions.has(missionId)) missions.set(missionId, String(row[COL.missionTitle]) || missionId);
    const key = key_(row[COL.student], row[COL.className], '');
    if (!students.has(key)) {
      students.set(key, { className: String(row[COL.className]), name: String(row[COL.student]), done: new Map() });
    }
    const done = students.get(key).done;
    if (!done.has(missionId)) done.set(missionId, row[COL.time]);
  }

  const ids = [...missions.keys()];
  const rows = [['Учень', 'Клас', 'Виконано', ...ids.map((id) => missions.get(id))]];
  const sorted = [...students.values()]
    .sort((a, b) => compareClasses_(a.className, b.className) || a.name.localeCompare(b.name, 'uk'));
  for (const student of sorted) {
    rows.push([
      safe_(student.name),
      safe_(student.className),
      student.done.size,
      ...ids.map((id) => {
        const time = student.done.get(id);
        if (time === undefined) return '';
        return time instanceof Date ? '✔ ' + Utilities.formatDate(time, timeZone, 'dd.MM') : '✔';
      }),
    ]);
  }

  const sheet = sheet_(SUMMARY_SHEET);
  const width = rows[0].length;
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, width).setValues(rows);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  [190, 60, 90].forEach((px, i) => sheet.setColumnWidth(i + 1, px));
  for (let column = 4; column <= width; column += 1) sheet.setColumnWidth(column, 110);
  if (width > 3) sheet.getRange(1, 4, rows.length, width - 3).setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
}
