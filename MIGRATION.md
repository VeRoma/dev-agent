# Миграция dev-agent на новую структуру (Фаза 1)

## Что сделано
- `processAgentTask` (~220 строк) разрезан на модули `src/engine/*`; оркестратор `task-runner.js` — 47 строк.
  Самый большой файл был 452 строки, стал 159.
- Все пути состояния — в одном месте (`src/project/state-paths.js`): `<проект>/.dev-agent/{session.md,PROJECT_MAP.md,backups/}`.
- Живой цикл получил защиты из meta-agent: белый список команд с подтверждением, лимит авто-подгрузки файлов (3),
  защита патчей (пути, заглушки, синтаксис, усечение, «всё или ничего»), линтер без shell, повтор при битом JSON.
- LLM: адаптеры ollama / deepseek / claude / gemini и роутер по имени модели. `cloudFallbacks` из конфига теперь работает.
- Карта проекта (`PROJECT_MAP.md`) вместо `.meta.json` рядом с каждым исходником; хранится в `.dev-agent/`, а не в репозитории.
- Бот выбирает проект по имени, не по номеру; без выбора задачи не принимаются; параллельный запуск блокируется;
  без PowerShell (`execFile` + переменная окружения).
- Удалён мёртвый код: `src/core/chat.js`, `src/utils/*`, сломанный CommonJS-`tester.js`, тестовые огрызки.

## Как применить (Git Bash, из папки dev-agent)

```bash
git add -A && git commit -m "before refactor"

# 1. убрать старые файлы
rm -rf src/core src/fs src/utils
rm -f src/cli/chat.js src/cli/chat.meta.json src/cli/runner.js src/cli/runner.meta.json
rm -f test-fs.js test_fallback.js test.txt agent.meta.json dev-bot/dev-bot.meta.json .agent_prompt.tmp .agent_session.tmp
rm -f tests/fs.test.js tests/patch-guard.test.js tests/safe-path.test.js

# 2. скопировать новые файлы поверх (путь к распакованному архиву подставьте свой)
cp -rf /d/temp/dev-agent-refactored/dev-agent/. .

# 3. зависимости и тесты
npm install        # не npm ci: package-lock.json нужно обновить
npm test           # ожидается: pass 25, fail 0
```

`.env` и `node_modules` в архиве нет, они остаются на месте. `agent.config.json` перезаписывается:
если вы правили его после выгрузки, перенесите свои правки (из него убрано только неиспользуемое `workspace.backupDir`).

## На что обратить внимание
- **Зависимости:** добавлен `@anthropic-ai/sdk` (нужен только если используете Claude), убраны `dotenv`, `leva`, `vitest`.
  Секреты читаются встроенным `process.loadEnvFile` (Node ≥ 20.12).
- **Модель с неизвестным именем** теперь даёт понятную ошибку, а не молча уходит в DeepSeek.
  Нужен «общий шлюз» — задайте `llm.defaultProvider` (`deepseek` / `claude` / `gemini` / `ollama`).
- **Проекты** берутся из `../repositories` (как и раньше в `agent.js`); бот теперь читает ту же папку.
- **В целевых проектах** уберите мусор старого индексатора и добавьте служебную папку в `.gitignore`:
  ```bash
  find ../repositories -name '*.meta.json' -not -path '*/node_modules/*'   # посмотреть
  echo '.dev-agent/' >> ../repositories/<проект>/.gitignore
  ```
- Откат: `git reset --hard <коммит "before refactor">`.
