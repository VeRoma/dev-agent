# dev-agent — notes for Claude

Autonomous coding agent ("two in one"): works on projects in `../repositories/<name>` and improves itself
(project `self`). meta-agent was merged into it on 2026-11-02 and is archived. README.md = user docs (Russian),
ARCHITECTURE.md = module map, CHANGES.md = history.

## Language
- Talk to the user in Russian.
- Code comments, JSDoc and docs inside code files: technical English only (token economy for models).
- User-facing strings (console output, bot replies, README) stay Russian; do not translate them unasked.
- When editing a file, translate its remaining Russian comments to English.

## Layout (D:\distr\Programming)
- `ai-core/` — shared package `@veroma/ai-core` (github.com/VeRoma/ai-core), linked as `file:../ai-core`.
  Exports: `.` (createAI: tiers, providers, fallbacks, orchestrator, `onUsage`, `listAvailableModels`),
  `./json`, `./map`, `./safety` (path/patch/command guards), `./lock` (one agent per project).
  Change ai-core in its own repo with a semver bump + tag (`vX.Y.Z`); run its tests too.
- `dev-agent/` — this repo. `dev-agent-self/` — git worktree of this repo on branch `self-improve` (self mode).
- `meta-agent/` — archived; `meta-agent.js` refuses to run (`META_AGENT_LEGACY=1` overrides). Do not revive it.
- `repositories/` — the user's real projects. Do not run the agent on them for checks (it writes `.dev-agent/`
  and `PROJECT_MAP.md` there).

## Rules that must hold
- Guards live in ai-core, never in agent code: the agent must not be able to weaken its own protection
  while editing itself. Do not move them back or add bypasses.
- Self mode: the agent edits only the worktree, never its running copy (`assertNotAgentRoot`), never starts
  the worktree as a dev server, never merges/tags/pushes by itself. Releases are manual (`/self-diff` prints the steps).
- Models come only from `agent.config.json`; verify names with `listAvailableModels` (startup report) —
  providers drop models. Do not invent prices for `llm.pricing`.
- Auto-fix after `/run` only on real crashes and after confirmation; all input goes through the single
  `rl.on('line')` handler in `src/cli/terminal.js` (never `rl.question` while the chat waits).
- One config instance: `src/config.js`. One ai-core adapter: `src/llm/index.js`.

## Checks
- `npm test` (node:test, network mocked, no keys needed). Keep it green; ai-core: `cd ../ai-core && npm test`.
- Live checks: use a temporary project `../repositories/zz-agent-smoke-test` and delete it afterwards,
  or `AUTO_PROJECT=self` (the worktree; leave it clean, remove test noise from `.dev-agent/session.md`).
- Git Bash rewrites env values starting with `/` into Windows paths (`/run` → `C:/Program Files/Git/run`):
  set `MSYS_NO_PATHCONV=1` when passing `DEV_TASK=/command`.
- `core.autocrlf` is on: compare file contents ignoring CRLF in tests.
- Telegram bot (`dev-bot/`, ESM): check imports with empty `TELEGRAM_BOT_TOKEN=` so it does not connect.
