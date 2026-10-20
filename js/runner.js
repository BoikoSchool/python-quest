// Керує Python-worker: створення, очікування готовності, таймаут і перезапуск.
//
// Головний потік ніколи не чекає на Python «намертво». Якщо програма учня працює
// довше ліміту, worker вимикається (terminate) і створюється новий. interruptBuffer
// не використовуємо: він потребує SharedArrayBuffer, а той — заголовків COOP/COEP,
// яких GitHub Pages не дає.

const WORKER_URL = new URL('./py-worker.js', import.meta.url);

/** Ліміт часу на один запуск, якщо місія не задає свій (timeLimitMs). */
export const DEFAULT_TIME_LIMIT_MS = 5000;

/**
 * Python для сторінки. Стани (status):
 *   'loading' — Python готується;   'ready'  — можна запускати;
 *   'busy'    — виконує програму;   'failed' — не вдалося завантажити.
 * Про кожну зміну стану повідомляє onStatus(status, details).
 */
export class PythonRunner {
  constructor({ onStatus = () => {} } = {}) {
    this.onStatus = onStatus;
    this.status = 'loading';
    this.version = null;
    this.readyMs = null; // скільки часу готувався Python (для вимірів)
    this.worker = null;
    this.nextId = 1;
    this.current = null; // поточний запуск
    this.readyWaiters = [];
    this.start();
  }

  setStatus(status, details = {}) {
    this.status = status;
    this.onStatus(status, details);
  }

  /** Створює новий worker. Старий спершу вимикаємо, щоб у пам'яті не було двох Python. */
  start() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.setStatus('loading');
    const startedAt = performance.now();
    const worker = new Worker(WORKER_URL, { type: 'module' });
    this.worker = worker;
    worker.onmessage = (event) => {
      if (worker === this.worker) this.handleMessage(event.data, startedAt);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker === this.worker) this.handleFailure(event.message || 'worker не запустився');
    };
  }

  handleMessage(message, startedAt) {
    const run = this.current;
    switch (message.type) {
      case 'ready':
        this.version = message.version;
        this.readyMs = Math.round(performance.now() - startedAt);
        this.setStatus('ready', { version: this.version, readyMs: this.readyMs });
        this.resolveWaiters(true);
        break;
      case 'init-error':
        this.handleFailure(message.message);
        break;
      case 'progress':
        if (run && message.id === run.id) {
          run.results[message.index] = message.result;
          run.onProgress?.(message.index, message.result);
          this.armTimer(); // наступний запуск отримує свіжий ліміт
        }
        break;
      case 'done':
        if (run && message.id === run.id) this.finish({ results: message.results, timedOutAt: null, crashed: false });
        break;
      case 'crash':
        if (run && message.id === run.id) {
          this.finish({ results: run.results, timedOutAt: null, crashed: true });
          this.start();
        }
        break;
    }
  }

  /** Worker не завантажився або впав. */
  handleFailure(message) {
    if (this.current) {
      // Впав під час програми — повідомляємо про збій і готуємо новий Python.
      this.finish({ results: this.current.results, timedOutAt: null, crashed: true });
      this.start();
      return;
    }
    this.worker?.terminate();
    this.worker = null;
    this.setStatus('failed', { message });
    this.resolveWaiters(false);
  }

  resolveWaiters(ok) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const resolve of waiters) resolve(ok);
  }

  /** Чекає, поки Python буде готовий. true — готовий, false — не вдалося завантажити. */
  whenReady() {
    if (this.status === 'ready') return Promise.resolve(true);
    if (this.status === 'failed') return Promise.resolve(false);
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  armTimer() {
    const run = this.current;
    clearTimeout(run.timer);
    run.timer = setTimeout(() => {
      if (this.current !== run) return;
      // Час вичерпано: результати попередніх запусків лишаються, програма зупиняється разом із worker.
      this.finish({ results: run.results, timedOutAt: run.results.length, crashed: false });
      this.start();
    }, run.timeLimitMs);
  }

  finish(outcome) {
    const run = this.current;
    clearTimeout(run.timer);
    this.current = null;
    if (this.status === 'busy') this.setStatus('ready', { version: this.version, readyMs: this.readyMs });
    run.resolve(outcome);
  }

  /**
   * Запускає код окремо для кожного рядка вхідних даних з inputs — одним повідомленням до worker.
   * Повертає { results, timedOutAt, crashed, unavailable }:
   *   results[i]  — { stdout, stderr, transcript, error, timeMs } для inputs[i];
   *   timedOutAt  — номер запуску, на якому сплив час, або null;
   *   crashed     — Python несподівано зупинився;
   *   unavailable — Python так і не завантажився.
   */
  async run(code, inputs, { timeLimitMs = DEFAULT_TIME_LIMIT_MS, onProgress } = {}) {
    if (this.current) throw new Error('Python уже виконує програму');
    const ok = await this.whenReady();
    if (!ok) return { results: [], timedOutAt: null, crashed: false, unavailable: true };
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.current = { id, resolve, results: [], timer: null, timeLimitMs, onProgress };
      this.setStatus('busy');
      this.worker.postMessage({ id, code, inputs });
      this.armTimer();
    });
  }

  /** Повторна спроба після невдалого завантаження. */
  retry() {
    if (this.status === 'failed') this.start();
  }
}
