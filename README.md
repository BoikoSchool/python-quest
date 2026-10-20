# Python Quest

Тренажер Python для учнів 5–9 класів. Учні пишуть і запускають справжній Python просто в браузері шкільного планшета: нічого не треба встановлювати, достатньо відкрити посилання.

**Сайт:** https://boikoschool.github.io/python-quest/

- Код учня виконується лише на пристрої й нікуди не надсилається.
- Реєстрації немає, персональних даних не збираємо. Прогрес зберігається тільки в браузері цього пристрою.
- Повне технічне завдання: [docs/SPEC.md](docs/SPEC.md).

## Які пристрої підходять

- iPad: Safari, **iPadOS 16.4 або новіша**. Старіші iPad з iPadOS 16.0–16.3 безкоштовно оновлюються до 16.7.
- Android-планшет: **Chrome 112 або новіший**.
- Ноутбуки й комп'ютери з сучасним Chrome, Edge, Firefox або Safari теж працюють.

Ці мінімуми задає Pyodide — Python, зібраний для браузера.

## Як влаштовано

- Звичайні HTML, CSS і JavaScript без фреймворків. Сайт не потребує збирання: GitHub Pages віддає файли з репозиторію як є.
- Python — це [Pyodide](https://pyodide.org) **314.0.7** (Python 3.14). Ядро лежить у `vendor/pyodide/`, жодних CDN:
  `pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`.
- Python працює в окремому потоці (`js/py-worker.js`), тож сторінка не зависає. Якщо програма учня працює довше 5 секунд, потік зупиняється й запускається новий.
- Редактор коду — [CodeMirror 6](https://codemirror.net), зібраний в один файл `vendor/codemirror.js`.

| Файл | Що робить |
| --- | --- |
| `index.html`, `css/app.css` | сторінка і стилі |
| `js/app.js` | старт, перемикання екранів (карта, місія, пісочниця) |
| `js/ui.js` | малювання інтерфейсу |
| `js/editor.js` | редактор коду |
| `js/runner.js` | керує Python-потоком: таймаут, перезапуск |
| `js/py-worker.js` | завантажує Pyodide і виконує код учня |
| `js/checker.js` | порівнює вивід програми з очікуваним |
| `js/storage.js` | зберігає код і прогрес у браузері |
| `missions/` | місії: `index.json` і по файлу на місію |
| `tools/` | інструменти: збирання `vendor/` і перевірка місій |
| `tests/` | автотести Playwright |

## Робота з кодом

Потрібен [Node.js](https://nodejs.org) 18 або новіший.

```bash
npm install                              # інструменти й тести (сайту вони не потрібні)
npx serve .                              # локальний сервер, далі відкрий адресу, яку він покаже
node tools/validate-missions.mjs         # перевірка місій
npx playwright install webkit chromium   # один раз: браузери для тестів
npx playwright test                      # автотести на емуляції iPad і Android-планшета
```

**Перед кожним комітом** перевірка місій і тести Playwright мають бути зеленими.

На Linux браузерам для тестів можуть знадобитися системні бібліотеки: `sudo npx playwright install-deps`. На Ubuntu 26.04 зараз бракує лише `libavif16`: `sudo apt-get install libavif16`.

Тести запускають сайт за адресою `/python-quest/`, так само як на GitHub Pages (`tests/server.mjs`), тому помилки зі шляхами видно одразу. Щоб прогнати ті самі тести проти живого сайту:

```bash
PQ_BASE_URL=https://boikoschool.github.io/python-quest/ npx playwright test
```

## Як додати місію

Найпростіше — попросити Claude Code: `/add-mission цикли while, збір макулатури`.

Вручну:

1. Створи `missions/<id>.json`. Зразок — будь-яка наявна місія, формат описано в [docs/SPEC.md](docs/SPEC.md), розділ 4.
   - Обов'язкові поля: `id` (як назва файлу), `title`, `topic`, `task`, `starter`, `tests`.
   - Тестів щонайменше 3, і хоча б один прихований (`"hidden": true`). Додай граничні випадки: 0, від'ємні числа, порожній рядок.
   - Вхідні дані тесту: кожне значення з нового рядка (`"120\n25"`). Щоб передати один порожній рядок, пиши `"\n"`.
2. Напиши еталонний розв'язок у `missions/solutions/<id>.py`.
3. Додай `id` у потрібну тему в `missions/index.json`. Поле `topic` місії має збігатися з назвою теми.
4. Запусти `node tools/validate-missions.mjs`. Він перевірить, що розв'язок проходить усі тести, а стартовий шаблон — ні.

### Еталонні розв'язки — лише локально

Папка `missions/solutions/` записана в `.gitignore`, і в публічний репозиторій розв'язки не потрапляють. Тому:

- **зроби резервну копію** цієї папки, наприклад у хмару: на GitHub її немає;
- у CI валідатор працює з прапорцем `--no-solutions` і перевіряє лише формат і шаблони;
- тести Playwright з еталонними розв'язками пропускаються там, де розв'язків немає.

## Як оновити Pyodide

Найпростіше — `/update-pyodide` у Claude Code. Вручну:

1. Прочитай примітки до випуску нової версії: https://pyodide.org/en/stable/project/changelog.html
2. `npm install --save-exact pyodide@<версія>`
3. `node tools/build-vendor.mjs` — скопіює нове ядро у `vendor/pyodide/`.
4. Онови номер версії в цьому README (з етапу 3 — ще й версію кешу в `sw.js`).
5. Перевірка місій і `npx playwright test` мають бути зеленими.

CodeMirror оновлюється так само: зміни версії в `package.json`, `npm install`, `node tools/build-vendor.mjs`.

## Публікація

Після кожного push у гілку `main` GitHub Actions (`.github/workflows/pages.yml`):

1. перевіряє місії (`--no-solutions`);
2. публікує на GitHub Pages **лише файли сайту**: `index.html`, `css/`, `js/`, `vendor/`, `missions/*.json`.

Додаєш до сайту новий файл чи папку — допиши їх у крок «Збираємо файли сайту» у workflow.

## Розмір першого завантаження

Буде виміряно після першої публікації.

## Що де лежить

- `docs/SPEC.md` — повне ТЗ (етапи 1–3).
- `CLAUDE.md` — короткі правила, які Claude читає в кожній сесії.
- `.claude/rules/` — правила, що вмикаються лише для місій і для коду Pyodide.
- `.claude/skills/` — навички:
  - `/add-mission`, `/tablet-check`, `/update-pyodide` — для цього проєкту;
  - `/liquid-glass-ui` — стиль «рідке скло» з запобіжниками для слабких планшетів;
  - `/frontend-design`, `/webapp-testing`, `/skill-creator` — офіційні навички Anthropic (github.com/anthropics/skills, ліцензія Apache 2.0).

## Ліцензії сторонніх бібліотек

Pyodide (MPL-2.0) і CodeMirror (MIT) — див. [vendor/LICENSES.txt](vendor/LICENSES.txt).
