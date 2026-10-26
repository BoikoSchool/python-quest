// Перевіряє місії в папці missions/. Запускай після кожної зміни місій:
//
//   node tools/validate-missions.mjs                 повна перевірка, разом з еталонними розв'язками
//   node tools/validate-missions.mjs --no-solutions  без розв'язків (так у CI: їх немає в репозиторії)
//
// Що перевіряється:
//   • missions/index.json і файли місій узгоджені між собою;
//   • обов'язкові поля й типи, тести (щонайменше 3, хоча б один прихований), запитання, підказки;
//   • пояснення learn: є, приклад запускається без помилок і НЕ проходить тести місії
//     (приклад має навчити, а не бути готовим розв'язком);
//   • еталонний розв'язок missions/solutions/<id>.py проходить усі тести й приклад;
//   • стартовий шаблон НЕ проходить тести.
// Python запускається тим самим кодом, що й на сайті (js/py-worker.js, js/checker.js).

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll, startPython } from '../js/py-worker.js';
import { evaluateTests, outputsMatch } from '../js/checker.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const missionsDir = join(root, 'missions');
const solutionsDir = join(missionsDir, 'solutions');
const checkSolutions = !process.argv.includes('--no-solutions');

const KNOWN_FIELDS = new Set([
  'id', 'title', 'topic', 'level', 'story', 'task', 'example', 'starter',
  'tests', 'hints', 'question', 'skills', 'timeLimitMs', 'learn',
]);
const LEARN_FIELDS = new Set(['title', 'text', 'code', 'input', 'lines', 'indent']);

const countSentences = (text) => text.split(/(?<=[.!?…])\s+/).filter(Boolean).length;

/** Рядки коду, що відкривають блок (if, for, while, def…): закінчуються на «:». */
const hasBlock = (code) => code.split('\n').some((line) => line.replace(/#.*$/, '').trimEnd().endsWith(':'));

/** Перевіряє поле learn. Помилки й попередження додає в errors і warnings. */
function checkLearn(learn, errors, warnings) {
  if (learn === undefined) {
    errors.push('поле learn обов\'язкове: пояснення теми з прикладом');
    return;
  }
  if (typeof learn !== 'object' || learn === null || Array.isArray(learn)) {
    errors.push('learn має бути { "title", "text", "code", "lines", … }');
    return;
  }
  for (const key of Object.keys(learn)) {
    if (!LEARN_FIELDS.has(key)) warnings.push(`learn: невідоме поле «${key}» (можливо, одрук?)`);
  }
  if (!isText(learn.title)) errors.push('learn.title обов\'язковий');
  if (!isText(learn.text)) {
    errors.push('learn.text обов\'язковий');
  } else {
    const sentences = countSentences(learn.text);
    if (sentences < 2 || sentences > 5) warnings.push(`у learn.text ${sentences} речень — радимо 2–5`);
  }
  if (!isText(learn.code)) {
    errors.push('learn.code обов\'язковий: приклад коду');
    return;
  }
  if (learn.input !== undefined && !isString(learn.input)) errors.push('learn.input має бути рядком');
  if (/\binput\s*\(/.test(learn.code) && learn.input === undefined) {
    errors.push('приклад читає input(), тож потрібне learn.input — вхідні дані для нього');
  }

  const codeLines = new Set(learn.code.split('\n').map((line) => line.trim()));
  if (!Array.isArray(learn.lines) || learn.lines.length === 0) {
    errors.push('learn.lines: потрібне пояснення хоча б одного рядка прикладу');
  } else {
    learn.lines.forEach((line, i) => {
      if (!isText(line?.code) || !isText(line?.text)) {
        errors.push(`learn.lines[${i}]: потрібні поля code і text`);
      } else if (!codeLines.has(line.code.trim())) {
        errors.push(`learn.lines[${i}]: рядка «${line.code}» немає в прикладі`);
      }
    });
  }
  if (hasBlock(learn.code) && !isText(learn.indent)) {
    errors.push('у прикладі є блок (рядок із «:»), тож потрібне learn.indent — пояснення відступів');
  }
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isString = (value) => typeof value === 'string';

/** Перевіряє поля однієї місії. Повертає { errors, warnings }. */
function checkFields(mission, fileId, topicByMission) {
  const errors = [];
  const warnings = [];

  if (typeof mission !== 'object' || mission === null || Array.isArray(mission)) {
    return { errors: ['файл має містити JSON-об\'єкт { … }'], warnings };
  }
  for (const key of Object.keys(mission)) {
    if (!KNOWN_FIELDS.has(key)) warnings.push(`невідоме поле «${key}» (можливо, одрук?)`);
  }

  if (mission.id !== fileId) errors.push(`поле id має бути «${fileId}», як назва файлу`);
  for (const field of ['title', 'topic', 'task']) {
    if (!isText(mission[field])) errors.push(`поле ${field} обов'язкове і не може бути порожнім`);
  }
  if (!isString(mission.starter)) errors.push('поле starter обов\'язкове (рядок, може бути порожнім)');

  const topic = topicByMission.get(fileId);
  if (topic && isText(mission.topic) && mission.topic !== topic) {
    errors.push(`topic «${mission.topic}» не збігається з темою в index.json «${topic}»`);
  }

  if (mission.level !== undefined && !(Number.isInteger(mission.level) && mission.level >= 1)) {
    errors.push('level має бути цілим числом від 1');
  }
  if (mission.story !== undefined) {
    if (!isText(mission.story)) {
      errors.push('story має бути непорожнім рядком');
    } else {
      const sentences = countSentences(mission.story);
      if (sentences > 2) warnings.push(`у story ${sentences} речення — радимо не більше 2`);
    }
  }
  if (mission.example !== undefined) {
    const ex = mission.example;
    if (typeof ex !== 'object' || ex === null || !isString(ex.output) || (ex.input !== undefined && !isString(ex.input))) {
      errors.push('example має бути { "input": "…", "output": "…" }');
    }
  }

  if (!Array.isArray(mission.tests)) {
    errors.push('поле tests обов\'язкове (список тестів)');
  } else {
    if (mission.tests.length < 3) errors.push(`тестів ${mission.tests.length}, а потрібно щонайменше 3`);
    if (mission.tests.length > 5) warnings.push(`тестів ${mission.tests.length} — за ТЗ їх 3–5`);
    if (!mission.tests.some((t) => t?.hidden === true)) errors.push('потрібен хоча б один прихований тест ("hidden": true)');
    mission.tests.forEach((t, i) => {
      if (typeof t !== 'object' || t === null || !isString(t.input) || !isString(t.output)) {
        errors.push(`тест ${i + 1}: потрібні рядкові поля input і output`);
        return;
      }
      if (t.hidden !== undefined && typeof t.hidden !== 'boolean') {
        errors.push(`тест ${i + 1}: hidden має бути true або false`);
      }
      for (const key of Object.keys(t)) {
        if (!['input', 'output', 'hidden'].includes(key)) warnings.push(`тест ${i + 1}: невідоме поле «${key}» (можливо, одрук?)`);
      }
    });
  }

  if (mission.hints !== undefined) {
    if (!Array.isArray(mission.hints) || !mission.hints.every(isText)) {
      errors.push('hints має бути списком непорожніх рядків');
    } else if (mission.hints.length > 3) {
      warnings.push(`підказок ${mission.hints.length} — учень відкриває щонайбільше 3`);
    }
  }
  if (mission.question !== undefined) {
    const q = mission.question;
    const ok = typeof q === 'object' && q !== null && isText(q.text)
      && Array.isArray(q.options) && q.options.length >= 2 && q.options.every(isText)
      && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
    if (!ok) errors.push('question має бути { "text": "…", "options": [щонайменше 2 варіанти], "answer": номер правильного з 0 }');
  }
  if (mission.skills !== undefined && !(Array.isArray(mission.skills) && mission.skills.every(isText))) {
    errors.push('skills має бути списком рядків');
  }
  checkLearn(mission.learn, errors, warnings);
  if (mission.timeLimitMs !== undefined
    && !(typeof mission.timeLimitMs === 'number' && mission.timeLimitMs >= 100 && mission.timeLimitMs <= 30000)) {
    errors.push('timeLimitMs має бути числом від 100 до 30000');
  }

  return { errors, warnings };
}

/** Коротко описує перший невдалий тест. */
function describeFailure(failure) {
  const name = `тест ${failure.index + 1}${failure.hidden ? ' (прихований)' : ''}`;
  if (failure.reason === 'error') {
    const { type, line, message } = failure.error;
    return `${name}: ${type}${line ? ` у рядку ${line}` : ''}${message ? ` — ${message}` : ''}`;
  }
  return `${name}: очікувалось ${JSON.stringify(failure.expected)}, отримано ${JSON.stringify(failure.actual)}`;
}

// --- index.json і список файлів ---

const globalErrors = [];
const topicByMission = new Map();
const orderedIds = [];

let index = null;
try {
  index = JSON.parse(await readFile(join(missionsDir, 'index.json'), 'utf8'));
} catch (error) {
  globalErrors.push(`missions/index.json не читається: ${error.message}`);
}
if (index) {
  if (!Array.isArray(index.topics) || index.topics.length === 0) {
    globalErrors.push('index.json: потрібен непорожній список topics');
  } else {
    index.topics.forEach((topic, i) => {
      if (!isText(topic?.title)) globalErrors.push(`index.json: тема ${i + 1} без назви (title)`);
      if (!Array.isArray(topic?.missions) || topic.missions.length === 0) {
        globalErrors.push(`index.json: у темі «${topic?.title ?? i + 1}» немає місій`);
        return;
      }
      for (const id of topic.missions) {
        if (topicByMission.has(id)) globalErrors.push(`index.json: місія «${id}» записана двічі`);
        topicByMission.set(id, topic.title);
        orderedIds.push(id);
      }
    });
  }
}

const files = (await readdir(missionsDir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
const fileIds = new Set(files.map((f) => f.replace(/\.json$/, '')));
for (const id of fileIds) {
  if (!topicByMission.has(id)) globalErrors.push(`missions/${id}.json є, але її немає в index.json`);
}
for (const id of orderedIds) {
  if (!fileIds.has(id)) globalErrors.push(`index.json посилається на «${id}», але файлу missions/${id}.json немає`);
}

// --- поля місій ---

const missions = [];
const reports = new Map();
for (const id of [...orderedIds.filter((id) => fileIds.has(id)), ...[...fileIds].filter((id) => !topicByMission.has(id))]) {
  let mission;
  try {
    mission = JSON.parse(await readFile(join(missionsDir, `${id}.json`), 'utf8'));
  } catch (error) {
    reports.set(id, { errors: [`JSON не читається: ${error.message}`], warnings: [], notes: [] });
    continue;
  }
  const { errors, warnings } = checkFields(mission, id, topicByMission);
  reports.set(id, { errors, warnings, notes: [] });
  if (errors.length === 0) missions.push(mission);
}

// --- запуск Python: розв'язки й шаблони ---

let python = null;
if (missions.length > 0) {
  try {
    python = await startPython();
  } catch (error) {
    globalErrors.push(`не вдалося запустити Pyodide: ${error.message}`);
  }
}
if (python) {
  console.log(`Python: Pyodide ${python.version}${checkSolutions ? '' : ' (розв\'язки не перевіряються: --no-solutions)'}`);
  try {
    for (const mission of missions) {
      const report = reports.get(mission.id);
      const inputs = mission.tests.map((t) => t.input);

      const starter = evaluateTests(mission.tests, { results: runAll(python, mission.starter, inputs), timedOutAt: null, crashed: false });
      if (starter.passed) report.errors.push('стартовий шаблон уже проходить усі тести — учневі нічого робити');
      else report.notes.push(`шаблон не проходить (${starter.passedCount}/${starter.total})`);

      // Приклад із learn: має працювати, але не розв'язувати місію.
      const [example] = runAll(python, mission.learn.code, [mission.learn.input ?? '']);
      if (example.error) {
        const { type, line, message } = example.error;
        report.errors.push(`приклад із learn падає: ${type}${line ? ` у рядку ${line}` : ''}${message ? ` — ${message}` : ''}`);
      }
      const learnTests = evaluateTests(mission.tests, { results: runAll(python, mission.learn.code, inputs), timedOutAt: null, crashed: false });
      if (learnTests.passed) report.errors.push('приклад із learn проходить усі тести місії — це готовий розв\'язок');
      else report.notes.push(`приклад не проходить (${learnTests.passedCount}/${learnTests.total})`);

      if (!checkSolutions) continue;
      const solutionFile = join(solutionsDir, `${mission.id}.py`);
      if (!existsSync(solutionFile)) {
        report.errors.push(`немає еталонного розв'язку missions/solutions/${mission.id}.py`);
        continue;
      }
      const code = await readFile(solutionFile, 'utf8');
      const solution = evaluateTests(mission.tests, { results: runAll(python, code, inputs), timedOutAt: null, crashed: false });
      if (solution.passed) report.notes.push(`розв'язок ${solution.passedCount}/${solution.total}`);
      else report.errors.push(`еталонний розв'язок не проходить — ${describeFailure(solution.failure)}`);

      if (mission.example) {
        const [result] = runAll(python, code, [mission.example.input ?? '']);
        if (result.error || !outputsMatch(mission.example.output, result.stdout)) {
          report.errors.push(`приклад не збігається з еталонним розв'язком: очікувалось ${JSON.stringify(mission.example.output)}, отримано ${JSON.stringify(result.stdout)}`);
        }
      }
    }
  } finally {
    python.close();
  }
}

// --- звіт ---

let errorCount = globalErrors.length;
let warningCount = 0;
for (const message of globalErrors) console.log(`✗ ${message}`);
for (const [id, report] of reports) {
  errorCount += report.errors.length;
  warningCount += report.warnings.length;
  const mark = report.errors.length > 0 ? '✗' : '✓';
  console.log(`${mark} ${id}${report.notes.length ? ` — ${report.notes.join(', ')}` : ''}`);
  for (const message of report.errors) console.log(`    помилка: ${message}`);
  for (const message of report.warnings) console.log(`    увага: ${message}`);
}
console.log(`\nМісій: ${reports.size}, помилок: ${errorCount}, попереджень: ${warningCount}.`);
process.exitCode = errorCount > 0 ? 1 : 0;
