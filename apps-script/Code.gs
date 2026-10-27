// Python Quest — приймач результатів у Google Таблиці вчителя.
//
// Як підключити — README, розділ «Результати в Google Таблиці (для вчителя)».
// Коротко: таблиця → Розширення → Apps Script → вставити цей файл → Розгорнути як вебзастосунок
// («Виконувати як: я», «Доступ: усі») → адресу …/exec вписати в js/config.js.
//
// Тренажер надсилає POST з JSON (Content-Type text/plain) про кожну зараховану місію:
//   { app: 'python-quest', time, student, className, missionId, missionTitle, checks, hints, minutes, code, uid }
//
// Аркуші створюються самі:
//   «Журнал»   — рядок на кожен запис. Той самий учень + клас + місія удруге не додається
//                (повторна відправка з черги планшета або та сама місія на іншому планшеті).
//   «Зведення» — учні × місії: ✔ і дата. Перебудовується після кожного нового запису;
//                вручну — меню «Python Quest → Оновити зведення».

const LOG_SHEET = 'Журнал';
const SUMMARY_SHEET = 'Зведення';
const LOG_HEADERS = ['Час виконання', 'Отримано', 'Учень', 'Клас', 'ID місії', 'Місія', 'Перевірок', 'Підказок', 'Хвилин', 'Код'];
const COL = { time: 0, student: 2, className: 3, missionId: 4, missionTitle: 5 }; // номери стовпців «Журналу» з 0
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
    .addItem('Оновити зведення', 'rebuildSummary')
    .addToUi();
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
    className: text_(data.className, 10, 'className'),
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
  if (headers && sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logRows_() {
  const sheet = sheet_(LOG_SHEET, LOG_HEADERS);
  const last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
}

/** Додає запис у «Журнал». false — такий учень цю місію вже здавав. */
function appendToLog_(record) {
  const key = key_(record.student, record.className, record.missionId);
  const exists = logRows_().some((row) => key_(row[COL.student], row[COL.className], row[COL.missionId]) === key);
  if (exists) return false;
  sheet_(LOG_SHEET, LOG_HEADERS).appendRow([
    record.time,
    new Date(),
    safe_(record.student),
    safe_(record.className),
    record.missionId,
    safe_(record.missionTitle),
    record.checks,
    record.hints,
    record.minutes,
    safe_(record.code),
  ]);
  return true;
}

/** Класи по порядку: 5-А, 5-Б, …, 10-А. */
function compareClasses_(a, b) {
  const [gradeA, letterA = ''] = String(a).split('-');
  const [gradeB, letterB = ''] = String(b).split('-');
  return (Number(gradeA) - Number(gradeB)) || letterA.localeCompare(letterB, 'uk');
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
  const rows = [['Клас', 'Учень', 'Виконано', ...ids.map((id) => missions.get(id))]];
  const sorted = [...students.values()]
    .sort((a, b) => compareClasses_(a.className, b.className) || a.name.localeCompare(b.name, 'uk'));
  for (const student of sorted) {
    rows.push([
      safe_(student.className),
      safe_(student.name),
      student.done.size,
      ...ids.map((id) => {
        const time = student.done.get(id);
        if (time === undefined) return '';
        return time instanceof Date ? '✔ ' + Utilities.formatDate(time, timeZone, 'dd.MM') : '✔';
      }),
    ]);
  }

  const sheet = sheet_(SUMMARY_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
}
