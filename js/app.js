// Точка входу: одразу починає готувати Python, завантажує місії і перемикає екрани.
//
// Екрани (адреса після #):
//   #/            карта місій
//   #/m/<id>      місія
//   #/sandbox     пісочниця
// Адреси з # не потребують налаштувань сервера, тож працюють на GitHub Pages.

import { DEFAULT_TIME_LIMIT_MS, PythonRunner } from './runner.js';
import { createEditor } from './editor.js';
import { evaluateTests } from './checker.js';
import * as storage from './storage.js';
import * as ui from './ui.js';

const MISSIONS_URL = new URL('../missions/', import.meta.url);
const main = document.getElementById('main');

// 1. Python готується у фоні, поки учень дивиться на карту.
const runner = new PythonRunner({
  onStatus: (status, details) => ui.showPythonStatus(status, details, () => runner.retry()),
});
storage.requestPersistence();

// 2. Місії: порядок і теми з missions/index.json, кожна місія — окремий файл.
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

// 3. Запуск і перевірка коду.

async function runCode(view, editor, { stdin, timeLimitMs }) {
  editor.clearErrorLine();
  view.setBusy(true, runner.status === 'ready' ? 'Виконується…' : 'Чекаємо, поки Python буде готовий…');
  const outcome = await runner.run(editor.getCode(), [stdin], { timeLimitMs });
  view.setBusy(false);
  view.showRunResult(outcome);
  const line = outcome.results[0]?.error?.line;
  if (line) editor.showErrorLine(line);
}

async function checkMission(view, editor, mission) {
  editor.clearErrorLine();
  view.setBusy(true, runner.status === 'ready' ? 'Перевіряємо…' : 'Чекаємо, поки Python буде готовий…');
  // Усі тести — одним повідомленням до worker.
  const outcome = await runner.run(editor.getCode(), mission.tests.map((test) => test.input), {
    timeLimitMs: mission.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
  });
  view.setBusy(false);
  const report = evaluateTests(mission.tests, outcome);
  const nextId = catalog.order[catalog.order.indexOf(mission.id) + 1];
  const next = nextId ? catalog.byId.get(nextId) : null;
  view.showCheckReport(report, {
    outcome,
    question: mission.question,
    onSolved: () => storage.markMissionDone(mission.id),
    next: next ? { title: next.title, href: `#/m/${next.id}` } : null,
  });
  const failure = report.failure;
  if (failure && !failure.hidden && failure.error?.line) editor.showErrorLine(failure.error.line);
}

// 4. Екрани.

let leaveScreen = () => {};

function openMap() {
  ui.setActiveNav('map');
  document.title = 'Python Quest — карта місій';
  ui.renderMap(main, {
    topics: catalog.topics,
    statusOf: storage.getMissionStatus,
    storageWorks: storage.isStorageWorking(),
  });
}

function openMission(mission) {
  ui.setActiveNav(null);
  document.title = `${mission.title} — Python Quest`;
  const saved = storage.getMissionWork(mission.id);
  const code = saved?.code ?? mission.starter;
  const timeLimitMs = mission.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;

  const view = ui.renderWorkspace(main, {
    mission,
    status: storage.getMissionStatus(mission.id),
    stdin: saved?.stdin ?? mission.example?.input ?? '',
    timeLimitMs,
    onStdinChange: (stdin) => storage.saveMissionWork(mission.id, { stdin }),
    onRun: () => {
      storage.saveMissionWork(mission.id, { code: editor.getCode(), stdin: view.getStdin() });
      runCode(view, editor, { stdin: view.getStdin(), timeLimitMs });
    },
    onCheck: () => {
      storage.saveMissionWork(mission.id, { code: editor.getCode() });
      checkMission(view, editor, mission);
    },
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
  leaveScreen = () => editor.destroy();
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

function route() {
  leaveScreen();
  leaveScreen = () => {};
  storage.flush();
  const [section, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (section === 'm' && catalog.byId.has(id)) openMission(catalog.byId.get(id));
  else if (section === 'sandbox') openSandbox();
  else openMap();
  scrollTo(0, 0);
}

addEventListener('hashchange', route);
route();
