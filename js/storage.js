// Прогрес учня в localStorage цього браузера. Нікуди не надсилається.
//
// Ключ містить версію схеми (pyquest:v1). Якщо формат колись зміниться,
// нова версія візьме інший ключ і перенесе старі дані, а не зламається на них.
//
// Що зберігаємо:
//   missions: { [id]: { code, stdin, status: 'started' | 'done', updatedAt } }
//   sandbox:  { code, stdin }
//   settings: { … }  (з'являться на наступних етапах)

const KEY = 'pyquest:v1';
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
