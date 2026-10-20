// Перевірка місії: порівнює вивід програми з очікуваним для кожного тесту.
// Тут лише чисті функції без сторінки й DOM — їх використовують і сайт,
// і tools/validate-missions.mjs, тож учень і валідатор перевіряються однаково.

/** Рядки виводу без пробілів у кінці рядків і без порожніх рядків наприкінці. */
export function normalizeOutput(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Чи збігається вивід із очікуваним (пробіли в кінці рядків і порожні рядки наприкінці не важать). */
export function outputsMatch(expected, actual) {
  const want = normalizeOutput(expected);
  const got = normalizeOutput(actual);
  return want.length === got.length && want.every((line, i) => line === got[i]);
}

/**
 * Звіт про перевірку місії.
 *
 * tests — тести з файлу місії: [{ input, output, hidden }].
 * run   — результат запуску всіх тестів: { results, timedOutAt, crashed }, де
 *         results[i] — { stdout, error, … } для тесту i (тести після таймауту відсутні),
 *         timedOutAt — номер тесту, на якому сплив час (або null),
 *         crashed    — чи впав сам Python.
 *
 * Повертає { passed, passedCount, total, failure }.
 * failure — перший невдалий тест або null:
 *   { index, hidden, reason, input, expected, actual, error },
 *   reason: 'wrong' (інший вивід), 'error' (помилка в програмі),
 *           'timeout' (надто довго), 'crash' (збій Python), 'not-run' (не дійшли).
 */
export function evaluateTests(tests, run) {
  let passedCount = 0;
  let failure = null;

  tests.forEach((test, index) => {
    const result = run.results[index];
    let reason = null;
    if (!result) {
      if (index === run.timedOutAt) reason = 'timeout';
      else if (run.crashed) reason = 'crash';
      else reason = 'not-run';
    } else if (result.error) {
      reason = 'error';
    } else if (!outputsMatch(test.output, result.stdout)) {
      reason = 'wrong';
    }

    if (reason === null) {
      passedCount += 1;
    } else if (failure === null) {
      failure = {
        index,
        hidden: Boolean(test.hidden),
        reason,
        input: test.input ?? '',
        expected: test.output,
        actual: result?.stdout ?? '',
        error: result?.error ?? null,
      };
    }
  });

  return { passed: passedCount === tests.length, passedCount, total: tests.length, failure };
}
