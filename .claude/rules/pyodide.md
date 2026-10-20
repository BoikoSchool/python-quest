---
paths:
  - "js/py-worker.js"
  - "js/runner.js"
  - "js/checker.js"
---
# Робота з Pyodide
- Спочатку await, потім методи результату. Ніколи runPythonAsync(...).toJs().
- Кожен PyProxy звільняй через .destroy() у finally.
- Кожен запуск — новий словник globals; sys.stdout та builtins.input відновлюй у finally.
- Таймаут = worker.terminate() + новий worker. SharedArrayBuffer та interruptBuffer недоступні на GitHub Pages.
- Усі тести місії — одним повідомленням до worker.
