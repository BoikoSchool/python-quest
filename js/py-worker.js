// Python в окремому потоці (Web Worker): завантажує Pyodide і виконує код учня.
//
// Файл працює у двох місцях:
//   • у браузері — як module worker, який створює js/runner.js;
//   • у Node — як звичайний модуль для tools/validate-missions.mjs, щоб валідатор
//     перевіряв місії рівно тим самим кодом, що й сайт.
//
// Повідомлення між головним потоком і worker:
//   → worker:  { id, code, inputs: ['вхідні дані для запуску 1', …] }
//   ← worker:  { type: 'ready', version }                 Python готовий
//              { type: 'init-error', message }            Python не вдалося завантажити
//              { type: 'progress', id, index, result }    закінчено запуск № index
//              { type: 'done', id, results: [ … ] }       закінчено всі запуски
//              { type: 'crash', id, message }             збій самого worker, а не коду учня
// Результат одного запуску: { stdout, stderr, transcript, error, timeMs }.

import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';

/** Скільки символів виводу дозволяємо одній програмі (захист пам'яті слабких планшетів). */
export const OUTPUT_LIMIT = 100_000;

// Обгортка, яка виконує код учня:
//   • кожен запуск отримує новий словник змінних;
//   • sys.stdout, sys.stderr, sys.stdin і input() підмінюються лише на час запуску
//     й завжди відновлюються у finally — помилка учня не ламає worker;
//   • результат повертається JSON-рядком, тож у JS не з'являється жодного PyProxy.
const HARNESS = String.raw`
import builtins, io, json, linecache, sys, traceback

_FILENAME = "main.py"


class _TooMuchOutput(BaseException):
    """Програма вивела забагато тексту. BaseException — щоб «except Exception» учня її не зловив."""


class _Console:
    """Усе, що бачить консоль, у порядку появи: вивід (out), помилки (err),
    підказки input() (prompt) і значення, які програма прочитала (echo)."""

    def __init__(self, limit):
        self.parts = []
        self.size = 0
        self.limit = limit

    def add(self, kind, text):
        self.size += len(text)
        if self.size > self.limit:
            raise _TooMuchOutput()
        if self.parts and self.parts[-1][0] == kind:
            self.parts[-1][1].append(text)
        else:
            self.parts.append([kind, [text]])

    def text(self, kind):
        return "".join("".join(chunks) for k, chunks in self.parts if k == kind)

    def transcript(self):
        return [[kind, "".join(chunks)] for kind, chunks in self.parts]


class _Stream(io.TextIOBase):
    """Підміна sys.stdout і sys.stderr."""

    def __init__(self, console, kind):
        self._console = console
        self._kind = kind

    def writable(self):
        return True

    def write(self, s):
        s = str(s)
        self._console.add(self._kind, s)
        return len(s)


def _keep_student_frames(te, seen):
    """Прибирає з traceback рядки нашої обгортки — учень бачить лише свій код."""
    if te is None or id(te) in seen:
        return
    seen.add(id(te))
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == _FILENAME])
    _keep_student_frames(te.__cause__, seen)
    _keep_student_frames(te.__context__, seen)


def _error_info(exc):
    """Тип помилки, повідомлення, номер рядка в коді учня і traceback."""
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == _FILENAME:
        line = exc.lineno
        message = exc.msg
    else:
        message = str(exc)
        for frame, lineno in traceback.walk_tb(exc.__traceback__):
            if frame.f_code.co_filename == _FILENAME:
                line = lineno
    te = traceback.TracebackException.from_exception(exc)
    _keep_student_frames(te, set())
    return {"type": type(exc).__name__, "message": message, "line": line,
            "traceback": "".join(te.format())}


def _pq_run(code, stdin_text, limit):
    console = _Console(limit)
    stdin = io.StringIO(stdin_text)

    def fake_input(prompt=""):
        console.add("prompt", str(prompt))
        line = stdin.readline()
        if not line:
            raise EOFError("EOF when reading a line")
        value = line[:-1] if line.endswith("\n") else line
        console.add("echo", value + "\n")
        return value

    saved_streams = (sys.stdout, sys.stderr, sys.stdin)
    saved_builtins = dict(builtins.__dict__)
    error = None
    try:
        sys.stdout = _Stream(console, "out")
        sys.stderr = _Stream(console, "err")
        sys.stdin = stdin
        builtins.input = fake_input
        # Щоб у traceback було видно сам рядок коду учня, як у звичайному Python.
        linecache.cache[_FILENAME] = (len(code), None, code.splitlines(True), _FILENAME)
        program_globals = {"__name__": "__main__", "__builtins__": builtins}
        exec(compile(code, _FILENAME, "exec"), program_globals)
    except SystemExit:
        pass
    except _TooMuchOutput:
        error = {"type": "TooMuchOutput", "message": "", "line": None, "traceback": ""}
    except BaseException as exc:
        error = _error_info(exc)
    finally:
        sys.stdout, sys.stderr, sys.stdin = saved_streams
        # Повертаємо вбудовані функції, навіть якщо програма їх змінила
        # (наприклад, import builtins; builtins.print = None).
        for name in list(builtins.__dict__):
            if name not in saved_builtins:
                del builtins.__dict__[name]
        builtins.__dict__.update(saved_builtins)
    return json.dumps({
        "stdout": console.text("out"),
        "stderr": console.text("err"),
        "transcript": console.transcript(),
        "error": error,
    }, ensure_ascii=False)
`;

/** Звідки брати файли Pyodide: у браузері — адреса поруч із сайтом, у Node — шлях на диску. */
async function pyodideIndexURL() {
  const url = new URL('../vendor/pyodide/', import.meta.url);
  if (url.protocol !== 'file:') return url.href;
  const { fileURLToPath } = await import('node:url');
  return fileURLToPath(url);
}

/**
 * Завантажує Pyodide і готує обгортку. Викликається один раз на worker.
 * Повертає об'єкт для runAll(); close() звільняє єдиний PyProxy (функцію обгортки).
 */
export async function startPython() {
  const pyodide = await loadPyodide({ indexURL: await pyodideIndexURL() });
  pyodide.runPython(HARNESS);
  const runOne = pyodide.globals.get('_pq_run');
  return {
    version: pyodide.version,
    runOne,
    close() {
      runOne.destroy();
    },
  };
}

/**
 * Запускає код учня окремо для кожного рядка вхідних даних з inputs.
 * onProgress(index, result) викликається після кожного запуску.
 */
export function runAll(python, code, inputs, onProgress = () => {}) {
  const results = [];
  for (let index = 0; index < inputs.length; index++) {
    const started = performance.now();
    const result = JSON.parse(python.runOne(code, inputs[index] ?? '', OUTPUT_LIMIT));
    result.timeMs = Math.round(performance.now() - started);
    results.push(result);
    onProgress(index, result);
  }
  return results;
}

// Далі — лише для браузерного worker. У Node цей блок не виконується.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const ready = startPython();
  ready.then(
    (python) => self.postMessage({ type: 'ready', version: python.version }),
    (error) => self.postMessage({ type: 'init-error', message: String(error?.message ?? error) }),
  );

  self.onmessage = async (event) => {
    const { id, code, inputs } = event.data;
    let python;
    try {
      python = await ready;
    } catch {
      return; // про невдале завантаження головний потік уже знає з 'init-error'
    }
    try {
      const results = runAll(python, code, inputs, (index, result) => {
        self.postMessage({ type: 'progress', id, index, result });
      });
      self.postMessage({ type: 'done', id, results });
    } catch (error) {
      self.postMessage({ type: 'crash', id, message: String(error?.message ?? error) });
    }
  };
}
