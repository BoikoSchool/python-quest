// Точка входу: одразу починає готувати Python, завантажує місії і перемикає екрани.
//
// Поки учень не сказав, хто він, на будь-якій адресі показуємо «Хто ти?» (планшети спільні).
// Екрани (адреса після #):
//   #/            карта місій
//   #/m/<id>      місія
//   #/sandbox     пісочниця
//   #/settings    налаштування: прогрес у файл і назад
// Адреси з # не потребують налаштувань сервера, тож працюють на GitHub Pages.

import { DEFAULT_TIME_LIMIT_MS, PythonRunner } from './runner.js';
import { createEditor } from './editor.js';
import { evaluateTests } from './checker.js';
import { keepPythonOffline, shouldSuggestHomeScreen, startOffline } from './offline.js';
import { resultsEnabled, sendResult, startResults } from './results.js';
import * as storage from './storage.js';
import * as ui from './ui.js';

const MISSIONS_URL = new URL('../missions/', import.meta.url);
const main = document.getElementById('main');

// 1. Робота без інтернету: Service Worker кешує сайт і Pyodide (js/offline.js, sw.js).
const offlineReady = startOffline({
  onUpdateReady: (apply) => ui.showUpdateBanner(() => {
    storage.flush(); // код учня зберігаємо до перезавантаження
    apply();
  }),
});
storage.requestPersistence();

// 2. Python готується у фоні, поки учень дивиться на карту. При першому відкритті — щойно
//    Service Worker керує сторінкою, щоб Pyodide одразу потрапив у кеш.
const runner = new PythonRunner({
  onStatus: (status, details) => ui.showPythonStatus(status, details, () => runner.retry()),
  startAfter: offlineReady,
});
runner.whenReady().then((ok) => ok && keepPythonOffline());

// Результати для вчителя, які не вдалося надіслати раніше, підуть зараз або коли з'явиться мережа.
startResults();

// 3. Місії: порядок і теми з missions/index.json, кожна місія — окремий файл.
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function loadCatalog() {
  const index = await fetchJson(new URL('index.json', MISSIONS_URL));
  const order = index.topics.flatMap((topic) => topic.missions);
  const missions = await Promise.all(order.map((id) => fetchJson(new URL(`${id}.json`, MISSIONS_URL))));
  const byId = new Map(missions.map((mission) => [mission.id, mission]));
  return {
    order,
    byId,
    topics: index.topics.map((topic) => ({ title: topic.title, missions: topic.missions.map((id) => byId.get(id)) })),
  };
}

let catalog;
try {
  catalog = await loadCatalog();
} catch (error) {
  ui.renderFatal(main, 'Не вдалося завантажити місії. Перевір інтернет і онови сторінку.');
  throw error;
}

// 4. Запуск і перевірка коду.

/** Один запуск коду з editor. show(outcome) показує результат (за замовчуванням — у «Результаті»). */
async function runCode(view, editor, { stdin, timeLimitMs, show = view.showRunResult }) {
  editor.clearErrorLine();
  view.setBusy(true, runner.status === 'ready' ? 'Виконується…' : 'Чекаємо, поки Python буде готовий…');
  const outcome = await runner.run(editor.getCode(), [stdin], { timeLimitMs });
  view.setBusy(false);
  show(outcome);
  const line = outcome.results[0]?.error?.line;
  if (line) editor.showErrorLine(line);
}

async function checkMission(view, editor, mission) {
  editor.clearErrorLine();
  view.setBusy(true, runner.status === 'ready' ? 'Перевіряємо…' : 'Чекаємо, поки Python буде готовий…');
  // Усі тести — одним повідомленням до worker. Учителю піде саме цей код, навіть якщо учень змінить його,
  // поки відповідає на запитання.
  const code = editor.getCode();
  const outcome = await runner.run(code, mission.tests.map((test) => test.input), {
    timeLimitMs: mission.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
  });
  view.setBusy(false);
  const report = evaluateTests(mission.tests, outcome);
  const nextId = catalog.order[catalog.order.indexOf(mission.id) + 1];
  const next = nextId ? catalog.byId.get(nextId) : null;
  view.showCheckReport(report, {
    outcome,
    question: mission.question,
    onSolved: () => solved(mission, code),
    next: next ? { title: next.title, href: `#/m/${next.id}` } : null,
  });
  const failure = report.failure;
  if (failure && !failure.hidden && failure.error?.line) editor.showErrorLine(failure.error.line);
}

/**
 * Місію зараховано. Якщо вперше і надсилання ввімкнене — запис для вчителя.
 * Повертає проміс 'sent' | 'queued' або null, якщо нічого не надсилаємо.
 */
function solved(mission, code) {
  if (!storage.markMissionDone(mission.id) || !resultsEnabled()) return null;
  const student = storage.currentProfile();
  const work = storage.getMissionWork(mission.id);
  return sendResult({
    time: new Date(work.doneAt).toISOString(),
    student: student.name,
    className: student.className,
    missionId: mission.id,
    missionTitle: mission.title,
    checks: work.checks ?? 0,
    hints: work.hints ?? 0,
    minutes: work.firstOpenedAt ? Math.round((work.doneAt - work.firstOpenedAt) / 60_000) : null,
    code,
  });
}

// 5. Екрани.

let leaveScreen = () => {};

function openMap() {
  ui.setActiveNav('map');
  document.title = 'Python Quest — карта місій';
  ui.renderMap(main, {
    topics: catalog.topics,
    statusOf: storage.getMissionStatus,
    storageWorks: storage.isStorageWorking(),
    sendingOn: resultsEnabled(),
    onHomeHintClose: shouldSuggestHomeScreen() && !storage.getSetting('homeHintClosed')
      ? () => storage.saveSetting('homeHintClosed', true)
      : null,
  });
}

function openMission(mission) {
  ui.setActiveNav(null);
  document.title = `${mission.title} — Python Quest`;
  storage.noteMissionOpened(mission.id);
  const saved = storage.getMissionWork(mission.id);
  const code = saved?.code ?? mission.starter;
  const timeLimitMs = mission.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;

  const view = ui.renderWorkspace(main, {
    mission,
    status: storage.getMissionStatus(mission.id),
    stdin: saved?.stdin ?? mission.example?.input ?? '',
    timeLimitMs,
    learnOpen: storage.isLearnOpen(mission.id),
    hintsOpened: saved?.hints ?? 0,
    onLearnToggle: (open) => storage.saveLearnOpen(mission.id, open),
    onHint: (count) => storage.saveHintsShown(mission.id, count),
    onStdinChange: (stdin) => storage.saveMissionWork(mission.id, { stdin }),
    onRun: () => {
      storage.saveMissionWork(mission.id, { code: editor.getCode(), stdin: view.getStdin() });
      runCode(view, editor, { stdin: view.getStdin(), timeLimitMs });
    },
    onCheck: () => {
      storage.saveMissionWork(mission.id, { code: editor.getCode() });
      storage.countCheck(mission.id);
      checkMission(view, editor, mission);
    },
    // Приклад з «Як це працює». Його зміни не зберігаємо: після оновлення сторінки він знову як був.
    onTryExample: () => runCode(view, exampleEditor, {
      stdin: view.getExampleInput(),
      timeLimitMs: DEFAULT_TIME_LIMIT_MS,
      show: (outcome) => view.showExampleResult(outcome, DEFAULT_TIME_LIMIT_MS),
    }),
  });
  const exampleEditor = mission.learn && createEditor(view.learnEditorHost, {
    doc: mission.learn.code,
    label: `Приклад: ${mission.learn.title}`,
  });
  const editor = createEditor(view.editorHost, {
    doc: code,
    label: `Код програми для місії «${mission.title}»`,
    onChange: (text) => {
      storage.saveMissionWork(mission.id, { code: text });
      view.codeChanged(text);
    },
  });
  view.codeChanged(code);
  leaveScreen = () => {
    editor.destroy();
    exampleEditor?.destroy();
  };
}

function openSandbox() {
  ui.setActiveNav('sandbox');
  document.title = 'Пісочниця — Python Quest';
  const saved = storage.getSandbox();
  const view = ui.renderWorkspace(main, {
    mission: null,
    stdin: saved.stdin,
    timeLimitMs: DEFAULT_TIME_LIMIT_MS,
    onStdinChange: (stdin) => storage.saveSandbox({ stdin }),
    onRun: () => runCode(view, editor, { stdin: view.getStdin(), timeLimitMs: DEFAULT_TIME_LIMIT_MS }),
  });
  const editor = createEditor(view.editorHost, {
    doc: saved.code,
    label: 'Код програми в пісочниці',
    placeholderText: 'Пиши тут свій код, наприклад: print("Привіт")',
    onChange: (text) => {
      storage.saveSandbox({ code: text });
      view.codeChanged(text);
    },
  });
  view.codeChanged(saved.code);
  leaveScreen = () => editor.destroy();
}

/** Віддає текст браузеру як файл для збереження (на iPad — у застосунок «Файли»). */
function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** «Олена Коваль», «6-А» → «Олена-Коваль-6-А» для назви файлу. */
const fileNamePart = (text) => text.trim().replace(/[\s\\/:*?"<>|]+/g, '-');

function openSettings() {
  ui.setActiveNav('settings');
  document.title = 'Налаштування — Python Quest';
  const student = storage.currentProfile();
  ui.renderSettings(main, {
    student,
    profiles: storage.listProfiles(),
    onExport() {
      const date = new Date().toISOString().slice(0, 10);
      const who = fileNamePart(`${student.name} ${student.className}`);
      saveFile(`python-quest-${who}-${date}.json`, JSON.stringify(storage.exportProgress(), null, 2));
      return 'Файл з прогресом збережено. Знайдеш його в завантаженнях або в застосунку «Файли».';
    },
    async onImport(file) {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('Не вдалося прочитати файл. Вибери файл, який зберіг тренажер, — він закінчується на .json.');
      }
      if (!confirm(`Додати прогрес із файлу до прогресу учня ${student.name}? Виконані місії лишаться виконаними.`)) return '';
      const count = storage.importProgress(data);
      return `Прогрес відновлено. Місій у файлі: ${count}.`;
    },
    onReset() {
      if (!confirm(`Точно стерти код і прогрес усіх місій учня ${student.name}? Повернути їх не вийде.`)) return '';
      storage.resetAll();
      return 'Усе скинуто. Можна починати спочатку.';
    },
    onDelete(profile) {
      if (!confirm(`Видалити учня ${profile.name} (${profile.className}) і весь його прогрес на цьому планшеті? `
        + 'Повернути не вийде.')) return '';
      storage.deleteProfile(profile.id);
      // Видалили себе — далі працює хтось інший.
      if (profile.id === student.id) setTimeout(route);
      return `Учня ${profile.name} видалено з цього планшета.`;
    },
  });
}

/** «Хто ти?» — поки учня не обрано. Після вибору відкриваємо ту саму адресу. */
function openWho() {
  document.title = 'Хто ти? — Python Quest';
  ui.renderWho(main, {
    profiles: storage.listProfiles(),
    legacy: storage.hasLegacyProgress(),
    sendingOn: resultsEnabled(),
    onPick: (id) => {
      storage.selectProfile(id);
      route();
    },
    onCreate: (profile) => {
      storage.createProfile(profile);
      route();
    },
  });
}

function switchStudent() {
  leaveScreen();
  leaveScreen = () => {};
  storage.leaveProfile();
  route();
}

function route() {
  leaveScreen();
  leaveScreen = () => {};
  storage.flush();
  const student = storage.currentProfile();
  ui.showStudent(student, switchStudent);
  if (!student) {
    openWho();
    scrollTo(0, 0);
    return;
  }
  const [section, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (section === 'm' && catalog.byId.has(id)) openMission(catalog.byId.get(id));
  else if (section === 'sandbox') openSandbox();
  else if (section === 'settings') openSettings();
  else openMap();
  scrollTo(0, 0);
}

addEventListener('hashchange', route);
route();
