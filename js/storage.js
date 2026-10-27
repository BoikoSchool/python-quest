// Профілі учнів і їхній прогрес у localStorage цього браузера.
//
// Планшети в школі спільні, тому в кожного учня свій профіль: ім'я, клас, код і прогрес.
// Паролів немає. Хто працює зараз — пам'ятає вкладка (sessionStorage): оновлення сторінки
// не питає знову, а нове відкриття сайту показує «Хто ти?».
//
// Ключі (версія схеми — v1; якщо формат колись зміниться, нова версія візьме інші ключі):
//   pyquest:v1:profiles        { list: [{ id, name, className, createdAt }] }
//   pyquest:v1:profile:<id>    прогрес одного учня (формат нижче)
//   pyquest:v1:outbox          черга записів для вчителя (js/results.js)
//   pyquest:v1                 старий прогрес до появи профілів — переходить до першого учня
//
// Прогрес учня:
//   missions: { [id]: { code, stdin, status: 'started' | 'done', updatedAt,
//                       firstOpenedAt, checks, hints, doneAt } }
//   sandbox:  { code, stdin }
//   settings: { homeHintClosed, learnOpen: { [id]: true | false } }
//             — лише для цього пристрою, в експорт не потрапляють
//
// Файл експорту: { app: 'python-quest', schema: 1, exportedAt, student, missions, sandbox }.

const LEGACY_KEY = 'pyquest:v1';
const PROFILES_KEY = 'pyquest:v1:profiles';
const CURRENT_KEY = 'pyquest:v1:current';
const profileKey = (id) => `pyquest:v1:profile:${id}`;
const SCHEMA = 1;
const SAVE_DELAY_MS = 500;

let saveTimer = null;
let storageWorks = true;
let profiles = loadProfiles();
let current = null; // профіль, з яким працюємо зараз
let state = emptyState();

function emptyState() {
  return { missions: {}, sandbox: { code: '', stdin: '' }, settings: {} };
}

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    storageWorks = false;
    return null;
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, value);
    storageWorks = true;
    return true;
  } catch (error) {
    storageWorks = false;
    console.warn('Не вдалося зберегти прогрес:', error);
    return false;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // нічого: сховище недоступне
  }
}

function loadProfiles() {
  try {
    const list = JSON.parse(readKey(PROFILES_KEY))?.list;
    return Array.isArray(list) ? list.filter((p) => typeof p?.id === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

function saveProfiles() {
  writeKey(PROFILES_KEY, JSON.stringify({ list: profiles }));
}

function loadState(key) {
  const raw = readKey(key);
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
      localStorage.setItem(`${key}:broken`, raw);
    } catch {
      // нічого: місця немає, але працювати далі можна
    }
    return emptyState();
  }
}

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (current) writeKey(profileKey(current.id), JSON.stringify(state));
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

// ---------- Профілі ----------

/** Усі учні цього планшета. */
export function listProfiles() {
  return profiles.map((profile) => ({ ...profile }));
}

/** Учень, який працює зараз, або null — тоді треба спитати «Хто ти?». */
export function currentProfile() {
  return current ? { ...current } : null;
}

/** Чи лежить на планшеті прогрес з часів до профілів (його отримає перший учень). */
export function hasLegacyProgress() {
  return profiles.length === 0 && readKey(LEGACY_KEY) !== null;
}

const sameText = (a, b) => a.trim().toLocaleLowerCase('uk') === b.trim().toLocaleLowerCase('uk');

/** Новий учень. Якщо такий учень цього класу вже є — просто обирає його. */
export function createProfile({ name, className }) {
  const existing = profiles.find((p) => sameText(p.name, name) && sameText(p.className, className));
  if (existing) return selectProfile(existing.id);

  const profile = { id: crypto.randomUUID(), name, className, createdAt: Date.now() };
  const first = profiles.length === 0;
  const legacy = first ? readKey(LEGACY_KEY) : null;
  if (legacy !== null && writeKey(profileKey(profile.id), legacy)) removeKey(LEGACY_KEY);
  profiles.push(profile);
  saveProfiles();
  return selectProfile(profile.id);
}

/** Працюємо з цим учнем: завантажуємо його прогрес. */
export function selectProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return null;
  flush();
  current = profile;
  state = loadState(profileKey(id));
  try {
    sessionStorage.setItem(CURRENT_KEY, id);
  } catch {
    // нічого: до оновлення сторінки учня пам'ятає змінна current
  }
  return { ...profile };
}

/** «Змінити учня»: зберігаємо прогрес і забуваємо, хто працює. */
export function leaveProfile() {
  flush();
  current = null;
  state = emptyState();
  try {
    sessionStorage.removeItem(CURRENT_KEY);
  } catch {
    // нічого
  }
}

/** Видаляє учня і весь його прогрес з цього планшета. Черги для вчителя не чіпає. */
export function deleteProfile(id) {
  if (current?.id === id) {
    clearTimeout(saveTimer);
    saveTimer = null;
    leaveProfile();
  }
  profiles = profiles.filter((p) => p.id !== id);
  saveProfiles();
  removeKey(profileKey(id));
}

// Після оновлення сторінки продовжуємо з тим самим учнем.
try {
  const id = sessionStorage.getItem(CURRENT_KEY);
  if (id) selectProfile(id);
} catch {
  // sessionStorage недоступне — спитаємо «Хто ти?»
}

// ---------- Місії ----------

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

/** Учень відкрив місію. Запам'ятовуємо час першого відкриття — з нього рахуємо хвилини для вчителя. */
export function noteMissionOpened(id) {
  const entry = state.missions[id];
  if (entry?.firstOpenedAt) return;
  if (entry) entry.firstOpenedAt = Date.now();
  else state.missions[id] = { status: 'started', firstOpenedAt: Date.now(), updatedAt: Date.now() };
  writeNow();
}

/** Учень натиснув «Перевірити». */
export function countCheck(id) {
  const entry = state.missions[id] ?? { status: 'started' };
  entry.checks = (entry.checks ?? 0) + 1;
  state.missions[id] = entry;
  saveLater();
}

/** Скільки підказок місії учень уже відкрив. */
export function saveHintsShown(id, count) {
  const entry = state.missions[id] ?? { status: 'started' };
  entry.hints = Math.max(entry.hints ?? 0, count);
  state.missions[id] = entry;
  writeNow();
}

/** Місію зараховано. Повертає true, лише якщо вона виконана вперше. */
export function markMissionDone(id) {
  const entry = state.missions[id] ?? {};
  const firstTime = entry.status !== 'done';
  entry.status = 'done';
  entry.updatedAt = Date.now();
  if (firstTime) entry.doneAt = entry.updatedAt;
  state.missions[id] = entry;
  writeNow();
  return firstTime;
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

/**
 * Чи розгорнутий блок «Як це працює» в місії. Якщо учень сам його не згортав і не розгортав:
 * у виконаній місії — згорнутий, в інших — розгорнутий.
 */
export function isLearnOpen(id) {
  return state.settings.learnOpen?.[id] ?? getMissionStatus(id) !== 'done';
}

export function saveLearnOpen(id, open) {
  saveSetting('learnOpen', { ...state.settings.learnOpen, [id]: open });
}

// ---------- Експорт, імпорт, скидання (для поточного учня) ----------

/** Прогрес поточного учня як об'єкт для файлу .json. */
export function exportProgress() {
  return {
    app: 'python-quest',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    student: current ? { name: current.name, className: current.className } : null,
    missions: state.missions,
    sandbox: state.sandbox,
  };
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const MISSION_ID = /^[a-z0-9][a-z0-9-]*$/;
const COUNTERS = ['firstOpenedAt', 'checks', 'hints', 'doneAt'];

/** Запис місії з файлу: лише відомі поля потрібних типів. null — якщо запис зіпсований. */
function cleanMissionEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const clean = {
    status: entry.status === 'done' ? 'done' : 'started',
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
  };
  if (typeof entry.code === 'string') clean.code = entry.code;
  if (typeof entry.stdin === 'string') clean.stdin = entry.stdin;
  for (const name of COUNTERS) {
    if (Number.isFinite(entry[name]) && entry[name] >= 0) clean[name] = entry[name];
  }
  return clean;
}

/**
 * Додає прогрес з файлу до прогресу поточного учня, нічого не губить:
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

/** Стирає весь прогрес поточного учня. */
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
