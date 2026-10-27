// Усе, що бачить учень: карта місій, робоче місце (умова, редактор, вхідні дані, результат)
// і стан Python у верхній панелі. Тут лише малювання; запуск і збереження — в app.js.

/** Створює елемент: h('p', { class: 'note' }, 'текст', інший елемент, …). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const STATUS_LABEL = { new: 'Не почато', started: 'В роботі', done: 'Виконано' };

// ---------- Стан Python у верхній панелі ----------

const PYTHON_TEXT = {
  loading: 'Готуємо Python…',
  ready: 'Python готовий',
  failed: 'Python не завантажився',
};

export function showPythonStatus(status, details, onRetry) {
  const root = document.documentElement;
  // Для тестів і вимірів: <html data-python="ready" data-python-ready-ms="2300">
  root.dataset.python = status;
  if (details?.readyMs) root.dataset.pythonReadyMs = String(details.readyMs);
  if (status === 'busy') return; // під час запуску стан показує панель кнопок, а не шапка

  const box = document.getElementById('py-status');
  box.replaceChildren(
    h('span', { class: `py-status__dot py-status__dot--${status}`, 'aria-hidden': 'true' }),
    h('span', {}, PYTHON_TEXT[status]),
  );
  if (status === 'failed') {
    box.append(h('button', { class: 'btn btn--small', type: 'button', onClick: onRetry }, 'Спробувати ще'));
  }
  document.getElementById('py-progress').hidden = status !== 'loading';
}

/**
 * Учень у верхній панелі й кнопка «Змінити учня». profile = null — учня ще не обрано:
 * ховаємо і його, і розділи сайту (поки екран «Хто ти?»).
 */
export function showStudent(profile, onSwitch) {
  const box = document.getElementById('student');
  document.querySelector('.topbar__nav').hidden = !profile;
  box.hidden = !profile;
  if (!profile) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h('span', { class: 'student__name' }, profile.name),
    h('span', { class: 'student__class' }, profile.className),
    h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Змінити учня (зараз ${profile.name})`,
      onClick: onSwitch }, 'Змінити учня'));
}

export function setActiveNav(name) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** Банер унизу екрана: вийшла нова версія сайту. onUpdate() вмикає її. */
export function showUpdateBanner(onUpdate) {
  if (document.querySelector('.update-banner')) return;
  const update = h('button', { class: 'btn btn--check btn--small', type: 'button',
    onClick: () => { update.disabled = true; onUpdate(); } }, 'Оновити');
  const banner = h('div', { class: 'update-banner', role: 'status' },
    h('span', {}, 'Доступне оновлення'),
    update,
    h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => banner.remove() }, 'Пізніше'));
  document.body.append(banner);
}

export function renderFatal(main, message) {
  main.replaceChildren(h('p', { class: 'notice notice--bad' }, message));
}

// ---------- Карта місій ----------

function firstSentence(text) {
  const match = text.match(/^.*?[.!?…](\s|$)/);
  return match ? match[0].trim() : text;
}

/** Підказка для iPad: сайт на головному екрані Safari не стирає. onClose — «Зрозуміло». */
function renderHomeHint(onClose) {
  const hint = h('div', { class: 'notice home-hint' },
    h('p', {},
      'Додай тренажер на головний екран: натисни «Поділитися» і вибери «На екран "Додому"». '
      + 'Так він відкриватиметься без інтернету, а Safari не зітре твій прогрес.'),
    h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { hint.remove(); onClose(); } }, 'Зрозуміло'));
  return hint;
}

export function renderMap(main, { topics, statusOf, storageWorks, sendingOn, onHomeHintClose = null }) {
  let number = 0;
  main.replaceChildren(
    h('div', { class: 'map' },
      h('h1', { class: 'map__title', tabindex: '-1' }, 'Карта місій'),
      h('p', { class: 'map__lead' }, 'Обери місію, прочитай історію, напиши програму й перевір її.'),
      !storageWorks && h('p', { class: 'notice notice--warn' },
        'Цей браузер не дає зберігати прогрес: код зникне, коли закриєш вкладку.'),
      onHomeHintClose && renderHomeHint(onHomeHintClose),
      ...topics.map((topic) => h('section', { class: 'topic', 'aria-label': topic.title },
        h('h2', { class: 'topic__title' }, topic.title),
        h('ol', { class: 'topic__missions' },
          ...topic.missions.map((mission) => {
            number += 1;
            const status = statusOf(mission.id);
            return h('li', {},
              h('a', { class: `mission-card mission-card--${status}`, href: `#/m/${mission.id}` },
                h('span', { class: 'mission-card__number', 'aria-hidden': 'true' }, String(number)),
                h('span', { class: 'mission-card__text' },
                  h('span', { class: 'mission-card__title' }, mission.title),
                  mission.story && h('span', { class: 'mission-card__story' }, firstSentence(mission.story))),
                h('span', { class: `chip chip--${status}` }, STATUS_LABEL[status])));
          })))),
      h('a', { class: 'sandbox-card', href: '#/sandbox' },
        h('span', { class: 'sandbox-card__title' }, 'Пісочниця'),
        h('span', { class: 'sandbox-card__text' }, 'Вільний редактор без завдання: пробуй що завгодно.')),
      h('p', { class: 'map__note' }, sendingOn
        ? 'Твій код і прогрес зберігаються лише на цьому планшеті. Про зараховані місії дізнається вчитель.'
        : 'Твій код і прогрес зберігаються лише на цьому планшеті.'),
    ),
  );
  main.querySelector('h1').focus({ preventScroll: true });
}

// ---------- «Хто ти?»: вибір учня на спільному планшеті ----------

// Латинські літери, які виглядають як українські: учень бачить «6-А», хоч набрав латинську A.
const LATIN_LOOKALIKE = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };

/**
 * Клас — як учень його пише: «6», «9 Харків», «6-А». Лише короткий запис «6а», «6 а», «6-а»
 * стає «6-А», щоб той самий клас не роздвоювався. null — якщо порожньо або задовго.
 */
export function normalizeClass(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!/[\p{L}\d]/u.test(clean) || clean.length > 30) return null;
  const short = clean.match(/^(\d{1,2}) ?[-–—]? ?(\p{L})$/u);
  if (!short) return clean;
  const letter = short[2].toUpperCase();
  return `${Number(short[1])}-${LATIN_LOOKALIKE[letter] ?? letter}`;
}

/** «  олена   коваль » → «Олена Коваль». null — якщо немає імені й прізвища. */
export function normalizeName(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.some((word) => !/^\p{L}/u.test(word))) return null;
  const name = words.map((word) => word[0].toLocaleUpperCase('uk') + word.slice(1)).join(' ');
  return name.length <= 60 ? name : null;
}

// Числа в назві класу порівнюються як числа: 5-Б, 6, 9 Харків, 10-А.
const byClass = (a, b) => a.localeCompare(b, 'uk', { numeric: true });

/**
 * Екран «Хто ти?». Спершу класи, які є на цьому планшеті, потім учні вибраного класу
 * (учнів може бути 150). «Я тут уперше» відкриває форму з іменем і класом.
 *   onPick(id) — учень знайшов себе; onCreate({ name, className }) — новий учень.
 *   legacy — на планшеті є прогрес з часів до профілів; sendingOn — результати бачить учитель.
 */
export function renderWho(main, { profiles, legacy, sendingOn, onPick, onCreate }) {
  const classes = [...new Set(profiles.map((p) => p.className))].sort(byClass);

  const screen = (lead, ...content) => {
    main.replaceChildren(h('div', { class: 'who' },
      h('h1', { class: 'map__title', tabindex: '-1' }, 'Хто ти?'),
      h('p', { class: 'map__lead' }, lead),
      ...content,
      sendingOn && h('p', { class: 'map__note' },
        'Коли місію зараховано, твоє ім\'я, клас і код отримає вчитель.')));
    main.querySelector('h1').focus({ preventScroll: true });
  };
  const firstTimeButton = (className) => h('button', { class: 'btn btn--check', type: 'button',
    onClick: () => showForm(className) }, 'Я тут уперше');

  function showClasses() {
    if (classes.length === 0) {
      showForm('');
      return;
    }
    screen('Обери свій клас.',
      h('ul', { class: 'who__grid' }, ...classes.map((className) => h('li', {},
        h('button', { class: 'who__choice who__choice--class', type: 'button', onClick: () => showStudents(className) },
          className)))),
      h('div', { class: 'who__actions' }, firstTimeButton('')));
  }

  function showStudents(className) {
    const students = profiles.filter((p) => p.className === className)
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    screen(`Клас ${className}. Знайди своє ім'я.`,
      h('ul', { class: 'who__grid who__grid--names' }, ...students.map((student) => h('li', {},
        h('button', { class: 'who__choice', type: 'button', onClick: () => onPick(student.id) }, student.name)))),
      h('div', { class: 'who__actions' },
        firstTimeButton(className),
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: showClasses }, '← Інший клас')));
  }

  function showForm(className) {
    const field = (id, label, attrs) => [
      h('label', { class: 'who__label', for: id }, label),
      h('input', { class: 'who__input', id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', ...attrs }),
    ];
    const error = h('p', { class: 'who__error', role: 'alert' });
    const form = h('form', {
      class: 'who__form',
      onSubmit: (event) => {
        event.preventDefault();
        const name = normalizeName(form.elements.namedItem('name').value);
        const cls = normalizeClass(form.elements.namedItem('class').value);
        if (!name) error.textContent = 'Напиши ім\'я та прізвище, наприклад: Олена Коваль.';
        else if (!cls) error.textContent = 'Напиши свій клас, наприклад: 6-А.';
        else onCreate({ name, className: cls });
      },
    },
    ...field('who-name', 'Ім\'я та прізвище', { name: 'name', autocapitalize: 'words', placeholder: 'Олена Коваль', maxlength: '60' }),
    ...field('who-class', 'Клас', { name: 'class', autocapitalize: 'sentences', placeholder: '6-А', maxlength: '30', value: className || null }),
    error,
    h('div', { class: 'who__actions' },
      h('button', { class: 'btn btn--check', type: 'submit' }, 'Почати'),
      classes.length > 0 && h('button', { class: 'btn btn--ghost', type: 'button',
        onClick: () => (className ? showStudents(className) : showClasses()) }, 'Назад')));

    screen('Напиши своє ім\'я, прізвище й клас. Пароль не потрібен.',
      legacy && h('p', { class: 'notice' }, 'Прогрес, який уже є на цьому планшеті, перейде до першого учня.'),
      form);
  }

  showClasses();
}

// ---------- Налаштування: прогрес у файл і назад, учні планшета ----------

/**
 * Малює екран налаштувань. Самі дії — в app.js:
 *   onExport(), onImport(file), onReset(), onDelete(profile) повертають текст для учня
 *   (або кидають помилку з текстом). student — поточний учень, profiles — усі учні планшета.
 */
export function renderSettings(main, { student, profiles, onExport, onImport, onReset, onDelete }) {
  const message = h('p', { class: 'settings__message', role: 'status', 'aria-live': 'polite' });
  const show = (text, kind) => {
    message.textContent = text;
    message.className = `settings__message settings__message--${kind}`;
  };
  // Кнопка біля кожної дії: показує результат або зрозумілу помилку.
  const act = async (action) => {
    try {
      const text = await action();
      if (text) show(text, 'ok');
    } catch (error) {
      show(error.message, 'bad');
    }
  };

  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onChange: () => {
      const file = fileInput.files[0];
      fileInput.value = ''; // щоб той самий файл можна було вибрати ще раз
      if (file) act(() => onImport(file));
    },
  });

  main.replaceChildren(
    h('div', { class: 'settings' },
      h('h1', { class: 'map__title', tabindex: '-1' }, 'Налаштування'),
      message,
      h('section', { class: 'settings__card', 'aria-labelledby': 'progress-title' },
        h('h2', { class: 'settings__title', id: 'progress-title' }, `Мій прогрес: ${student.name}, ${student.className}`),
        h('p', {}, 'Прогрес зберігається лише в цьому браузері на цьому планшеті. '
          + 'Safari може стерти його, якщо довго не заходити на сайт.'),
        h('p', {}, 'Збережи прогрес у файл, щоб не втратити його або перенести на інший пристрій. '
          + 'Під час відновлення нічого не зникає: виконані місії лишаються виконаними.'),
        h('div', { class: 'settings__actions' },
          h('button', { class: 'btn btn--check', type: 'button', onClick: () => act(onExport) }, 'Експортувати прогрес'),
          h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => fileInput.click() }, 'Імпортувати прогрес'),
          fileInput)),
      h('section', { class: 'settings__card', 'aria-labelledby': 'reset-title' },
        h('h2', { class: 'settings__title', id: 'reset-title' }, 'Почати спочатку'),
        h('p', {}, 'Видаляє твій код і прогрес усіх місій на цьому планшеті. Інших учнів це не зачепить.'),
        h('div', { class: 'settings__actions' },
          h('button', { class: 'btn btn--danger', type: 'button', onClick: () => act(onReset) }, 'Скинути все'))),
      h('section', { class: 'settings__card', 'aria-labelledby': 'students-title' },
        h('h2', { class: 'settings__title', id: 'students-title' }, 'Видалити учня з цього планшета'),
        h('p', {}, 'Учень зникне зі списку «Хто ти?» разом зі своїм кодом і прогресом на цьому планшеті. '
          + 'Те, що вже надіслано вчителю, лишається в таблиці.'),
        h('ul', { class: 'settings__students' },
          ...[...profiles].sort((a, b) => byClass(a.className, b.className) || a.name.localeCompare(b.name, 'uk'))
            .map((profile) => {
              const item = h('li', { class: 'settings__student' },
                h('span', {}, `${profile.className} · ${profile.name}`),
                h('button', { class: 'btn btn--danger btn--small', type: 'button',
                  'aria-label': `Видалити учня ${profile.name}, ${profile.className}`,
                  onClick: () => act(() => {
                    const text = onDelete(profile);
                    if (text) item.remove();
                    return text;
                  }) }, 'Видалити'));
              return item;
            }))),
    ),
  );
  main.querySelector('h1').focus({ preventScroll: true });
}

// ---------- Пояснення помилок ----------
// Словник з docs/SPEC.md, п. 3.4. Для інших помилок учень бачить лише оригінал Python.

const ERROR_TEXT = {
  TypeError: 'Операцію виконано над несумісними типами, наприклад рядок + число. '
    + 'Число з рядка отримаєш через int(), а рядок із числа — через str().',
  ValueError: 'Не вдалося перетворити значення. Наприклад, int("абв") не дає числа.',
  ZeroDivisionError: 'Ділення на нуль. На нуль ділити не можна.',
};

function explainError(error, inCheck) {
  switch (error.type) {
    case 'SyntaxError':
      return `${error.line ? `У рядку ${error.line} порушено` : 'Порушено'} правила запису. Перевір дужки, лапки та двокрапку.`;
    case 'IndentationError':
    case 'TabError':
      return 'Відступи не збігаються. Усередині блоку однакові відступи — 4 пробіли.';
    case 'NameError': {
      const name = error.message?.match(/name '(.+?)' is not defined/)?.[1];
      return `Python не знає імені${name ? ` «${name}»` : ''}. Можливо, змінна ще не створена або є одрук.`;
    }
  }
  if (ERROR_TEXT[error.type]) return ERROR_TEXT[error.type];
  if (error.type === 'EOFError') {
    return inCheck
      ? 'Програма просить більше вхідних даних, ніж є в тесті.'
      : 'Програма просить більше вхідних даних, ніж їх задано в полі «Вхідні дані».';
  }
  if (error.type === 'TooMuchOutput') {
    return 'Програма виводить забагато тексту. Можливо, print() стоїть у циклі, який не закінчується.';
  }
  return null;
}

function renderError(error, { inCheck = false } = {}) {
  const explanation = explainError(error, inCheck);
  return h('div', { class: 'problem' },
    h('p', { class: 'problem__title' }, error.line ? `Помилка в рядку ${error.line}` : 'Помилка'),
    explanation && h('p', { class: 'problem__text' }, explanation),
    error.type !== 'TooMuchOutput' && h('p', { class: 'problem__original' },
      error.message ? `${error.type}: ${error.message}` : error.type));
}

function renderProblem(title, text) {
  return h('div', { class: 'problem' },
    h('p', { class: 'problem__title' }, title),
    text && h('p', { class: 'problem__text' }, text));
}

const timeoutProblem = (limitMs) => renderProblem(
  'Програма працює надто довго — можливо, цикл не закінчується.',
  `Ми зупинили її через ${Math.round(limitMs / 1000)} с. Виправ код і запусти знову.`);
const crashProblem = () => renderProblem('Python несподівано зупинився.', 'Спробуй запустити ще раз.');
const unavailableProblem = () => renderProblem(
  'Python не завантажився.',
  'Перевір інтернет і натисни «Спробувати ще» вгорі сторінки.');

function formatMs(ms) {
  return ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

/** Вивід програми так, як у терміналі: текст, помилки, підказки input() і прочитані значення. */
function renderTranscript(parts) {
  return h('pre', { class: 'console' },
    ...parts.map(([kind, text]) => (kind === 'out' ? text : h('span', { class: `console__${kind}` }, text))));
}

const block = (label, text, emptyText) => h('div', { class: 'io' },
  h('p', { class: 'io__label' }, label),
  text === '' ? h('p', { class: 'io__empty' }, emptyText) : h('pre', { class: 'io__text' }, text));

/** Що показати після одного запуску: вивід, помилку чи пояснення, чому програму зупинено. */
function renderRunOutcome(outcome, timeLimitMs) {
  const nodes = [];
  const result = outcome.results[0];
  if (outcome.unavailable) {
    nodes.push(unavailableProblem());
  } else if (result) {
    nodes.push(result.transcript.length > 0
      ? renderTranscript(result.transcript)
      : h('p', { class: 'output__nothing' }, 'Програма нічого не вивела.'));
    if (result.error) nodes.push(renderError(result.error));
    else nodes.push(h('p', { class: 'output__time' }, `Виконано за ${formatMs(result.timeMs)}`));
  }
  if (outcome.timedOutAt !== null) nodes.push(timeoutProblem(timeLimitMs));
  if (outcome.crashed) nodes.push(crashProblem());
  return nodes;
}

const textArea = (attrs) => h('textarea', {
  rows: '2', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs,
});

// ---------- «Як це працює»: пояснення теми з прикладом, який можна запустити ----------

/**
 * Блок над завданням місії (поле learn). open — розгорнутий чи згорнутий спочатку;
 * onToggle(open) — учень сам розгорнув чи згорнув блок.
 * Редактор для прикладу створює app.js у editorHost; «Спробувати» викликає onTry().
 */
function renderLearn(learn, { open, onTry, onToggle }) {
  const editorHost = h('div', { class: 'editor editor--example' });
  const inputField = learn.input === undefined ? null
    : textArea({ class: 'stdin__field', id: 'learn-input' });
  if (inputField) inputField.value = learn.input;
  const tryButton = h('button', { class: 'btn btn--run btn--small', type: 'button', 'aria-label': 'Спробувати приклад', onClick: onTry },
    h('span', { 'aria-hidden': 'true' }, '▶'), 'Спробувати');
  const output = h('div', { class: 'learn__output', 'aria-live': 'polite' });

  const box = h('details', { class: 'learn', open },
    h('summary', { class: 'learn__summary' },
      h('span', { class: 'learn__label' }, 'Як це працює'),
      h('span', { class: 'learn__title' }, learn.title)),
    h('p', { class: 'learn__text' }, learn.text),
    h('p', { class: 'learn__note' }, 'Приклад можна змінювати. Натисни «Спробувати» й подивись, що вийде.'),
    editorHost,
    inputField && h('div', { class: 'learn__input' },
      h('label', { class: 'stdin__help', for: 'learn-input' }, 'Вхідні дані для прикладу'),
      inputField),
    h('div', { class: 'learn__actions' }, tryButton),
    output,
    learn.lines?.length > 0 && h('dl', { class: 'learn__lines' },
      ...learn.lines.flatMap((line) => [h('dt', {}, h('code', {}, line.code)), h('dd', {}, line.text)])),
    learn.indent && h('div', { class: 'learn__indent' },
      h('h3', { class: 'learn__subtitle' }, 'Відступи'),
      h('p', {}, learn.indent)));

  // Браузер надсилає toggle і тоді, коли блок відкрито під час малювання, — таке пропускаємо.
  let shownOpen = open;
  box.addEventListener('toggle', () => {
    if (box.open === shownOpen) return;
    shownOpen = box.open;
    onToggle(shownOpen);
  });

  return { box, editorHost, tryButton, output, getInput: () => inputField?.value ?? '' };
}

// ---------- Підказки: по одній, коли учень сам попросить ----------

/** opened — скільки підказок учень уже відкрив раніше; onShow(count) — відкрив ще одну. */
function renderHints(hints, { opened = 0, onShow }) {
  let shown = 0;
  const list = h('ol', { class: 'hints__list', 'aria-live': 'polite' });
  const button = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Не виходить? Підказка');
  const showNext = () => {
    list.append(h('li', {}, hints[shown]));
    shown += 1;
    if (shown === hints.length) button.hidden = true;
    else button.textContent = `Ще підказка (${shown + 1} з ${hints.length})`;
  };
  while (shown < Math.min(opened, hints.length)) showNext();
  button.addEventListener('click', () => {
    showNext();
    onShow(shown);
  });
  return h('div', { class: 'hints' }, list, button);
}

const SENT_TEXT = {
  sending: 'Надсилаю результат учителю…',
  sent: '✔ Результат надіслано вчителю',
  queued: 'Результат надішлеться, коли з\'явиться інтернет',
};

// ---------- Робоче місце: місія або пісочниця ----------

/**
 * Малює робоче місце. mission = null — це пісочниця.
 * Повертає об'єкт, через який app.js оновлює екран.
 */
export function renderWorkspace(main, {
  mission, status, stdin, timeLimitMs, learnOpen, hintsOpened, onRun, onCheck, onStdinChange, onTryExample,
  onLearnToggle, onHint,
}) {
  const editorHost = h('div', { class: 'editor' });
  const learn = mission?.learn
    ? renderLearn(mission.learn, { open: learnOpen, onTry: onTryExample, onToggle: onLearnToggle })
    : null;

  const stdinField = textArea({
    class: 'stdin__field',
    id: 'stdin-field',
    'aria-describedby': 'stdin-help',
    onInput: (event) => onStdinChange(event.target.value),
  });
  stdinField.value = stdin;
  const stdinBox = h('details', { class: 'stdin' },
    h('summary', {}, 'Вхідні дані'),
    h('label', { class: 'stdin__help', id: 'stdin-help', for: 'stdin-field' },
      'Кожне значення — з нового рядка. Програма читає їх по черзі через input().'),
    stdinField);

  const runButton = h('button', { class: 'btn btn--run', type: 'button', 'aria-label': 'Запустити програму', onClick: onRun },
    h('span', { 'aria-hidden': 'true' }, '▶'), 'Запустити');
  const checkButton = mission && h('button', { class: 'btn btn--check', type: 'button', 'aria-label': 'Перевірити місію', onClick: onCheck },
    h('span', { 'aria-hidden': 'true' }, '✓'), 'Перевірити');
  const busyText = h('span', { class: 'toolbar__status', role: 'status' });

  const emptyOutput = () => h('p', { class: 'output__empty' },
    mission ? 'Натисни «Запустити», щоб побачити, що виводить програма, або «Перевірити», щоб здати місію.'
      : 'Натисни «Запустити», і тут з\'явиться результат.');
  const outputBody = h('div', { class: 'output__body', 'aria-live': 'polite' }, emptyOutput());
  const output = h('section', { class: 'output', 'aria-labelledby': 'output-title' },
    h('div', { class: 'output__head' },
      h('h2', { class: 'output__title', id: 'output-title' }, 'Результат'),
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': 'Очистити результат',
        onClick: () => outputBody.replaceChildren(emptyOutput()) }, 'Очистити')),
    outputBody);

  // Після запуску чи перевірки показуємо результат, навіть якщо він нижче краю екрана.
  const revealOutput = () => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    output.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  };

  const doneChip = h('span', { class: 'chip chip--done', hidden: status !== 'done' }, 'Виконано');
  const taskPanel = mission && h('section', { class: 'task', 'aria-labelledby': 'task-title' },
    h('p', { class: 'task__topic' }, mission.topic),
    h('div', { class: 'task__heading' },
      h('h1', { class: 'task__title', id: 'task-title', tabindex: '-1' }, mission.title),
      doneChip),
    mission.story && h('p', { class: 'task__story' }, mission.story),
    learn?.box,
    learn && h('h2', { class: 'example__title' }, 'Твоє завдання'),
    h('p', { class: 'task__text' }, mission.task),
    mission.example && h('div', { class: 'example' },
      h('h2', { class: 'example__title' }, 'Приклад'),
      h('div', { class: 'example__io' },
        mission.example.input ? block('Вхідні дані', mission.example.input, '') : null,
        block('Програма виводить', mission.example.output, '(нічого)'))),
    h('p', { class: 'task__back' }, h('a', { href: '#/' }, 'До карти місій')));

  const workPanel = h('section', { class: 'work', 'aria-label': 'Код і результат' },
    !mission && h('h1', { class: 'work__title', tabindex: '-1' }, 'Пісочниця'),
    h('div', { class: 'toolbar' }, runButton, checkButton, busyText),
    editorHost,
    mission?.hints?.length > 0 && renderHints(mission.hints, { opened: hintsOpened, onShow: onHint }),
    stdinBox,
    output);

  main.replaceChildren(h('div', { class: mission ? 'workspace' : 'workspace workspace--sandbox' }, taskPanel, workPanel));
  main.querySelector('h1').focus({ preventScroll: true });

  let codeHasInput = null;

  return {
    editorHost,
    getStdin: () => stdinField.value,
    learnEditorHost: learn?.editorHost ?? null,
    getExampleInput: () => learn?.getInput() ?? '',

    /** Поле «Вхідні дані» розгорнуте, лише якщо в коді є input(. */
    codeChanged(code) {
      const hasInput = /\binput\s*\(/.test(code);
      if (hasInput !== codeHasInput) stdinBox.open = hasInput;
      codeHasInput = hasInput;
    },

    setBusy(busy, text = '') {
      runButton.disabled = busy;
      if (checkButton) checkButton.disabled = busy;
      if (learn) learn.tryButton.disabled = busy;
      busyText.textContent = busy ? text : '';
    },

    showRunResult(outcome) {
      outputBody.replaceChildren(...renderRunOutcome(outcome, timeLimitMs));
      revealOutput();
    },

    /** Результат прикладу з «Як це працює» — під самим прикладом. */
    showExampleResult(outcome, exampleTimeLimitMs) {
      learn.output.replaceChildren(...renderRunOutcome(outcome, exampleTimeLimitMs));
    },

    /**
     * Звіт перевірки. Якщо всі тести пройдено — запитання на розуміння (якщо є),
     * а після правильної відповіді onSolved() і кнопка «Наступна місія».
     * onSolved() може повернути проміс 'sent' | 'queued' — тоді показуємо, що з результатом для вчителя.
     */
    showCheckReport(report, { outcome, question, onSolved, next }) {
      if (outcome.unavailable) {
        outputBody.replaceChildren(unavailableProblem());
        revealOutput();
        return;
      }
      const nodes = [];
      if (report.passed) {
        nodes.push(h('p', { class: 'verdict verdict--ok' }, `Усі тести пройдено: ${report.total} з ${report.total}.`));
      } else {
        nodes.push(h('p', { class: 'verdict verdict--bad' }, `Пройдено ${report.passedCount} з ${report.total} тестів.`));
        nodes.push(renderFailure(report.failure, timeLimitMs));
      }
      outputBody.replaceChildren(...nodes);
      if (!report.passed) {
        revealOutput();
        return;
      }

      const showSuccess = () => {
        const sending = onSolved();
        doneChip.hidden = false;
        // Поки результат іде вчителю, далі не пускаємо: інакше учень часто йде зі сторінки,
        // не дочекавшись відповіді. Це триває не довше 15 с, потім запис просто чекає в черзі.
        const target = next ? next.href : '#/';
        const go = h('button', {
          class: next ? 'btn btn--run' : 'btn btn--check',
          type: 'button',
          disabled: Boolean(sending),
          onClick: () => { location.hash = target; },
        }, next ? 'Наступна місія' : 'До карти місій');
        const sent = h('p', { class: `success__sent${sending ? ' success__sent--sending' : ''}`, role: 'status' },
          sending && [h('span', { class: 'spinner', 'aria-hidden': 'true' }), SENT_TEXT.sending]);
        const success = h('div', { class: 'success' },
          h('p', { class: 'success__title' }, 'Місію виконано!'),
          go,
          next && h('p', { class: 'success__next' }, next.title),
          sent);
        sending?.then((result) => {
          sent.replaceChildren(SENT_TEXT[result]);
          sent.className = `success__sent success__sent--${result}`;
          go.disabled = false;
          go.focus({ preventScroll: true });
        });
        const form = outputBody.querySelector('.question');
        if (form) form.replaceWith(success);
        else outputBody.append(success);
        if (!sending) go.focus({ preventScroll: false });
        else success.scrollIntoView({ block: 'nearest' });
      };
      if (question) {
        outputBody.append(renderQuestion(question, showSuccess));
        revealOutput();
      } else {
        showSuccess();
      }
    },
  };
}

function renderFailure(failure, timeLimitMs) {
  if (failure.reason === 'timeout') return timeoutProblem(timeLimitMs);
  if (failure.reason === 'crash') return crashProblem();
  if (failure.hidden) {
    return renderProblem('Прихований тест не пройдено.',
      'Перевір, чи програма правильно працює з будь-якими вхідними даними, а не лише з прикладом.');
  }
  const title = h('p', { class: 'failure__title' }, `Тест ${failure.index + 1}`);
  const input = block('Вхідні дані', failure.input, '(немає)');
  if (failure.reason === 'error') {
    return h('div', { class: 'failure' }, title, input, renderError(failure.error, { inCheck: true }));
  }
  return h('div', { class: 'failure' }, title, input,
    block('Очікувалось', failure.expected, '(нічого)'),
    block('Твоя програма вивела', failure.actual, '(нічого)'));
}

let questionCounter = 0;

function renderQuestion(question, onCorrect) {
  questionCounter += 1;
  const name = `question-${questionCounter}`;
  const feedback = h('p', { class: 'question__feedback', 'aria-live': 'polite' });
  const form = h('form', {
    class: 'question',
    onSubmit: (event) => {
      event.preventDefault();
      const chosen = form.querySelector('input:checked');
      if (!chosen) feedback.textContent = 'Обери одну відповідь.';
      else if (Number(chosen.value) === question.answer) onCorrect();
      else feedback.textContent = 'Ні, подумай ще раз.';
    },
  },
  h('fieldset', { class: 'question__set' },
    h('legend', { class: 'question__text' }, question.text),
    ...question.options.map((option, i) => h('label', { class: 'question__option' },
      h('input', { type: 'radio', name, value: String(i) }),
      h('span', {}, option)))),
  h('button', { class: 'btn btn--check', type: 'submit' }, 'Відповісти'),
  feedback);
  return form;
}
