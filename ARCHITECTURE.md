# Архитектура dev-agent

```
agent.js                 вход: выбор проекта (меню или AUTO_PROJECT), подготовка, запуск чата
src/config.js            конфиг + .env (единственный экземпляр на процесс)
src/cli/                 интерфейс: terminal (readline), chat-loop, commands (/save, /abort ...), editor-input
src/engine/              «мозг»
  task-runner.js           оркестратор: контекст -> модель -> чат | патч -> проверки -> самолечение
  context-builder.js       @упоминания + выбор файлов
  routing.js               диспетчер (дешёвая модель выбирает файлы по карте проекта)
  prompt.js, executor.js   промпт и вызов исполнителя (JSON, одна повторная попытка)
  patch-pipeline.js        патч -> команды -> проверки, возвращает исход
  command-runner.js        белый список команд + подтверждение (через io.js)
  linter.js, tester.js, checks.js   ESLint/TS и npm test целевого проекта
  dev-server.js, server-supervisor.js   запуск проекта и авто-исправление падений
  session.js, io.js        память диалога; мост к интерфейсу (подтверждения)
src/llm/                 провайдеры (ollama, deepseek, claude, gemini), роутер с fallback-цепочкой, переводы
src/project/             всё про файлы проекта
  state-paths.js           ВСЕ пути состояния (.dev-agent/...) вычисляются здесь
  file-manager.js          список файлов (.agentignore) и чтение контекста
  project-map.js           PROJECT_MAP.md (экспорты JS/TS, классы Java/Python, список прочих файлов)
  patcher.js, backups.js, rollback.js   запись патчей, бэкапы v2, /abort и /redo
  history.js, projects.js, editor.js
src/safety/              safe-path, patch-guard, command-guard, json-utils
dev-bot/                 Telegram-бот (отдельный package.json)
tests/                   node --test
```

Правила слоёв (`config.js` — общая база): `safety` ни от чего не зависит; `llm` — только от config; `project` зависит от `safety`; `engine` — от `project`, `llm`,
`safety`; `cli` — от `engine`. Движок не знает про readline: подтверждения запрашиваются через `engine/io.js`.
