---
paths:
  - "missions/**/*.json"
---
# Місії
- Обов'язкові поля: id, title, topic, task, starter, tests.
- Мінімум 3 тести, з них хоча б один "hidden": true; обов'язково граничні випадки (0, від'ємні, порожній рядок).
- Еталонний розв'язок — у missions/solutions/<id>.py; на сторінку не завантажується.
- Тексти — для 10–15 років: до 2 речень у story, без жаргону.
- Після змін запусти node tools/validate-missions.mjs.
