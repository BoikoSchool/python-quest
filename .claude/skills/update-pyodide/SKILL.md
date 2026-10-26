---
name: update-pyodide
description: Оновлює Pyodide у vendor/pyodide/ до нової стабільної версії.
disable-model-invocation: true
---
1. Знайди актуальну стабільну версію Pyodide та її примітки до випуску; покажи мені зміни, що ламають сумісність.
2. Після мого підтвердження заміни файли ядра у vendor/pyodide/.
3. Онови номер версії в README і PYODIDE_VERSION у sw.js (тест tests/offline.spec.js звіряє її з package.json). VERSION у sw.js не чіпай — її підставляє CI.
4. Запусти /tablet-check.
