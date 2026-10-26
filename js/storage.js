// Прогрес учня в localStorage цього браузера. Нікуди не надсилається.
//
// Ключ містить версію схеми (pyquest:v1). Якщо формат колись зміниться,
// нова версія візьме інший ключ і перенесе старі дані, а не зламається на них.
//
// Що зберігаємо:
//   missions: { [id]: { code, stdin, status: 'started' | 'done', updatedAt } }
//   sandbox:  { code, stdin }
//   settings: { homeHintClosed }  — лише для цього пристрою, в експорт не потрапляють
//
// Файл експорту: { app: 'python-quest', schema: 1, exportedAt, missions, sandbox }.

const KEY = 'pyquest:v1';
const SCHEMA = 1;
const SAVE_DELAY_MS = 500;

let saveTimer = null;
let storageWorks = true;
const state = load();

function emptyState() {
  return { missions: {}, sandbox: { code: '', stdin: '' }, settings: {} };
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    storageWorks = false;
    return emptyState();
  }
  if (!raw) return emptyState();
  try {
    const saved = JSON.parse(raw);
    return {
      missions: saved.missions ?? {},
      sandbox: { ...emptyState().sandbox, ...saved.sandbox },
      settings: saved.settings ?? {},
    };
  } catch {
    // Пошкоджені дані не викидаємо: кладемо копію поруч, щоб їх можна було відновити.
    try {
      localStorage.setItem(`${KEY}:broken`, raw);
    } catch {
      // нічого: місця немає, але працювати далі можна
    }
    return emptyState();
  }
}

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageWorks = true;
  } catch (error) {
    storageWorks = false;
    console.warn('Не вдалося зберегти прогрес:', error);
  }
}

function saveLater() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, SAVE_DELAY_MS);
}

/** Зберегти негайно все, що чекає на збереження. */
export function flush() {
  if (saveTimer !== null) writeNow();
}

// Коли вкладку закривають або ховають (планшет блокується), зберігаємо без затримки.
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

/** Чи вдається зберігати (наприклад, у деяких приватних режимах — ні). */
export function isStorageWorking() {
  return storageWorks;
}

/** Збережена робота над місією або null. */
export function getMissionWork(id) {
  return state.missions[id] ?? null;
}

/** 'new' — не почато, 'started' — в роботі, 'done' — виконано. */
export function getMissionStatus(id) {
  return state.missions[id]?.status ?? 'new';
}

/** Зберегти код і/або вхідні дані місії (з затримкою 500 мс). Місія стає «в роботі». */
export function saveMissionWork(id, { code, stdin } = {}) {
  const entry = state.missions[id] ?? { status: 'started' };
  if (code !== undefined) entry.code = code;
  if (stdin !== undefined) entry.stdin = stdin;
  entry.updatedAt = Date.now();
  state.missions[id] = entry;
  saveLater();
}

/** Місію зараховано. */
export function markMissionDone(id) {
  const entry = state.missions[id] ?? {};
  entry.status = 'done';
  entry.updatedAt = Date.now();
  state.missions[id] = entry;
  writeNow();
}

export function getSandbox() {
  return state.sandbox;
}

export function saveSandbox({ code, stdin } = {}) {
  if (code !== undefined) state.sandbox.code = code;
  if (stdin !== undefined) state.sandbox.stdin = stdin;
  saveLater();
}

export function getSetting(name) {
  return state.settings[name];
}

export function saveSetting(name, value) {
  state.settings[name] = value;
  writeNow();
}

// ---------- Експорт, імпорт, скидання ----------

/** Увесь прогрес як об'єкт для файлу .json. */
export function exportProgress() {
  return {
    app: 'python-quest',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    missions: state.missions,
    sandbox: state.sandbox,
  };
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const MISSION_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Запис місії з файлу: лише відомі поля потрібних типів. null — якщо запис зіпсований. */
function cleanMissionEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const clean = {
    status: entry.status === 'done' ? 'done' : 'started',
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
  };
  if (typeof entry.code === 'string') clean.code = entry.code;
  if (typeof entry.stdin === 'string') clean.stdin = entry.stdin;
  return clean;
}

/**
 * Додає прогрес з файлу до прогресу на цьому пристрої, нічого не губить:
 *   • місія виконана, якщо вона виконана хоча б в одному з двох джерел;
 *   • код і вхідні дані беруться з новішого запису;
 *   • пісочниця з файлу — лише якщо тут вона порожня.
 * Повертає кількість місій у файлі. Якщо файл не підходить — кидає помилку з поясненням для учня.
 */
export function importProgress(data) {
  if (!isPlainObject(data) || data.app !== 'python-quest' || !isPlainObject(data.missions)) {
    throw new Error('Це не файл прогресу Python Quest.');
  }
  if (data.schema !== SCHEMA) {
    throw new Error('Цей файл зроблено іншою версією тренажера. Онови сторінку й спробуй ще раз.');
  }

  let count = 0;
  for (const [id, entry] of Object.entries(data.missions)) {
    const incoming = cleanMissionEntry(entry);
    if (!MISSION_ID.test(id) || !incoming) continue;
    count += 1;
    const local = state.missions[id];
    if (!local) {
      state.missions[id] = incoming;
      continue;
    }
    const [older, newer] = (incoming.updatedAt > (local.updatedAt ?? 0)) ? [local, incoming] : [incoming, local];
    state.missions[id] = {
      ...older,
      ...newer,
      status: local.status === 'done' || incoming.status === 'done' ? 'done' : 'started',
    };
  }

  const sandbox = isPlainObject(data.sandbox) ? data.sandbox : {};
  if (state.sandbox.code === '' && state.sandbox.stdin === '') {
    if (typeof sandbox.code === 'string') state.sandbox.code = sandbox.code;
    if (typeof sandbox.stdin === 'string') state.sandbox.stdin = sandbox.stdin;
  }

  writeNow();
  return count;
}

/** Стирає весь прогрес на цьому пристрої. */
export function resetAll() {
  const empty = emptyState();
  state.missions = empty.missions;
  state.sandbox = empty.sandbox;
  state.settings = empty.settings;
  writeNow();
}

/**
 * Просимо браузер не стирати наші дані автоматично (Safari може стерти localStorage
 * приблизно після 7 днів без відвідувань). Повертає true, якщо браузер погодився.
 */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
