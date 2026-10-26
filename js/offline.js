// Робота без інтернету: реєструє Service Worker (sw.js) і повідомляє, коли вийшла нова версія сайту.
//
// Python запускаємо, коли Service Worker уже керує сторінкою: тоді файли Pyodide (13 МБ) проходять
// через нього й одразу потрапляють у кеш, а не завантажуються вдруге через повільний шкільний Wi-Fi.
// Чекати доводиться лише при першому відкритті, і не довше за CONTROL_WAIT_MS.

const SW_URL = new URL('../sw.js', import.meta.url);
const CONTROL_WAIT_MS = 8000;

/**
 * Реєструє Service Worker. Повертає проміс, який виконується, коли Service Worker керує сторінкою
 * (або коли чекати вже досить) — після нього можна запускати Python.
 * Коли нова версія сайту завантажилася й чекає, викликає onUpdateReady(apply):
 * apply() вмикає нову версію й перезавантажує сторінку.
 * Якщо щось не вдалося, сайт просто працює далі без офлайн-режиму.
 */
export async function startOffline({ onUpdateReady }) {
  if (!('serviceWorker' in navigator)) return;
  let registration;
  try {
    registration = await navigator.serviceWorker.register(SW_URL);
  } catch (error) {
    console.warn('Офлайн-режим недоступний:', error);
    return;
  }

  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Перезавантажуємо лише після «Оновити», а не під час першого встановлення.
    if (applying) location.reload();
  });

  const offer = (worker) => {
    // Без контролера це перше встановлення, а не оновлення — банер не потрібен.
    if (!navigator.serviceWorker.controller) return;
    onUpdateReady(() => {
      applying = true;
      worker.postMessage('skip-waiting');
    });
  };
  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });

  // Урок триває довго, а вкладку не перезавантажують: перевіряємо оновлення, коли учень повертається на сторінку.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });

  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    setTimeout(resolve, CONTROL_WAIT_MS);
  });
}

/** Python готовий: просимо Service Worker докачати Pyodide, якщо той завантажився повз кеш. */
export function keepPythonOffline() {
  navigator.serviceWorker?.controller?.postMessage('cache-pyodide');
}

/** iPad чи iPhone, і сайт відкрито у браузері, а не з головного екрана. */
export function shouldSuggestHomeScreen() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS видає себе за Mac
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}
