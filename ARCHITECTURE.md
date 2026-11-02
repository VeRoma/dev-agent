# dev-agent architecture

```
agent.js                 entry: model check, project choice (menu or AUTO_PROJECT), lock, chat or DEV_TASK
src/config.js            config + .env (one instance per process)
src/cli/                 interface: terminal (single 'line' handler), chat-loop, commands (/audit, /save, /abort ...),
                         editor-input, model-report (model availability at startup)
src/engine/              the "brain"
  task-runner.js           task loop: context -> executor -> chat | patch -> checks -> self-healing with tier escalation
  context-builder.js       @mentions, model tags, orchestrator call, files filtered against the project map
  prompt.js, executor.js   executor prompt (task + orchestrator plan) and the JSON call (one retry)
  patch-pipeline.js        patch -> commands -> checks, returns the outcome
  command-runner.js        command whitelist + confirmation (via io.js)
  linter.js, tester.js, checks.js   ESLint/TS and npm test of the target project
  dev-server.js, server-supervisor.js   running the project; auto-fix only on real crashes, after confirmation
  session.js, io.js        dialog memory; bridge to the interface (confirmations, exclusive tasks)
src/llm/                 the only ai-core adapter (index.js), token usage of the current task (usage.js), translation
src/project/             everything about project files
  state-paths.js           ALL state paths (.dev-agent/...) are computed here
  file-manager.js          file list (.agentignore) and reading the context
  project-map.js           PROJECT_MAP.md (JS/TS exports, Java/Python classes, line counts, ⚠️ [GOD FILE])
  patcher.js, backups.js, rollback.js   writing patches, v2 backups, /abort and /redo
  history.js, projects.js, editor.js
dev-bot/                 Telegram bot (own package.json, ESM)
tests/                   node --test
```

Shared with meta-agent, from `@veroma/ai-core`: model tiers, providers and fallbacks, the orchestrator,
token usage reporting, JSON parsing, path/patch/command guards (`/safety`), the project lock (`/lock`).

Layer rules (`config.js` is the common base): `llm` depends only on config; `project` on ai-core safety;
`engine` on `project` and `llm`; `cli` on `engine`. The engine knows nothing about readline:
confirmations and exclusive background tasks go through `engine/io.js`.
