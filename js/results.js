// Результати для вчителя: запис про зараховану місію йде в Google Таблицю через Apps Script.
//
// Адреса — у js/config.js. Якщо вона порожня, цей модуль нічого не робить.
//
// Спершу запис потрапляє в чергу на планшеті (localStorage, pyquest:v1:outbox), а потім відправляється.
// Не вийшло (немає інтернету) — запис чекає й піде сам: при появі мережі, раз на кілька хвилин,
// поки сайт відкритий, або під час наступного відкриття сайту.
//
// Запит — POST з mode: 'no-cors' і Content-Type text/plain: так браузер не робить попереднього
// запиту CORS, який Apps Script не вміє приймати. Відповідь при цьому прочитати не можна, тож
// «надіслано» означає, що запит дійшов до сервера. Однаковий запис двічі таблиця не додасть.

import { RESULTS_URL } from './config.js';

const OUTBOX_KEY = 'pyquest:v1:outbox';
const MAX_RECORDS = 200;
const MAX_CODE_LENGTH = 20_000;
const SEND_TIMEOUT_MS = 15_000;
const RETRY_EVERY_MS = 2 * 60_000;

let sending = null; // проміс поточної відправки черги

export function resultsEnabled() {
  return RESULTS_URL !== '';
}

function readOutbox() {
  try {
    const list = JSON.parse(localStorage.getItem(OUTBOX_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeOutbox(list) {
  try {
    if (list.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn('Не вдалося зберегти чергу результатів:', error);
  }
}

async function post(record) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await fetch(RESULTS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(record),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Відправляє записи з черги по одному. Перша невдача — зупиняємось, решта чекає. */
async function drainQueue() {
  for (let next = readOutbox()[0]; next; next = readOutbox()[0]) {
    try {
      await post(next);
    } catch {
      return;
    }
    // Черга могла змінитися, поки йшов запит, тому прибираємо саме цей запис.
    writeOutbox(readOutbox().filter((record) => record.uid !== next.uid));
  }
}

/** Одна відправка черги за раз: повторний виклик повертає ту, що вже йде. */
function sendQueue() {
  // .finally спрацює вже після присвоєння, навіть якщо черга порожня.
  sending ??= drainQueue().finally(() => { sending = null; });
  return sending;
}

/**
 * Ставить запис про зараховану місію в чергу і пробує відправити.
 * Повертає 'sent' — запис дійшов, або 'queued' — він надішлеться пізніше.
 */
export async function sendResult(record) {
  const uid = crypto.randomUUID();
  const code = record.code.length > MAX_CODE_LENGTH ? record.code.slice(0, MAX_CODE_LENGTH) : record.code;
  writeOutbox([...readOutbox(), { app: 'python-quest', ...record, code, uid }].slice(-MAX_RECORDS));
  await sending; // якщо черга вже відправляється — дочекаємось і запустимо ще раз
  await sendQueue();
  return readOutbox().some((item) => item.uid === uid) ? 'queued' : 'sent';
}

/** Відправляє те, що лишилося в черзі, і далі стежить за мережею. */
export function startResults() {
  if (!resultsEnabled()) return;
  sendQueue();
  addEventListener('online', sendQueue);
  setInterval(() => {
    if (document.visibilityState === 'visible' && readOutbox().length > 0) sendQueue();
  }, RETRY_EVERY_MS);
}
