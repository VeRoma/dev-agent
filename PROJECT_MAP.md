# PROJECT MAP & DEPENDENCY GRAPH

> Structural overview, dependency graph, and static health flags for LLM navigation.
- **Module System**: `module`
- **Entry Points**: `agent.js`

### 📄 .gitignore
- (Configuration / Ignore file)

### 📄 agent.config.json
- (Configuration / Ignore file)

### 📄 agent.js (84 lines)
- *Imports*: `src/config.js`, `src/project/projects.js`, `src/project/state-paths.js`, `src/project/project-map.js`, `src/cli/terminal.js`, `src/cli/chat-loop.js`
- *Role*: Entry point / Controller / Service / Test
- (Internal logic / No exported functions)

### 📄 core/llm.js (50 lines)
- *Imported by*: `src/llm/index.js`, `src/llm/translate.js`
- **ai** (const)

### 📄 dev-bot/dev-bot.js (127 lines)
- *Role*: Entry point / Controller / Service / Test
- (Internal logic / No exported functions)

### 📄 dev-bot/package.json
- (Configuration / Ignore file)

### 📄 eslint.config.js (11 lines)
- *Role*: Entry point / Controller / Service / Test
- **default** (default export)

### 📄 package.json
- (Configuration / Ignore file)

### 📄 src/cli/chat-loop.js (56 lines)
- *Imports*: `src/config.js`, `src/engine/session.js`, `src/engine/task-runner.js`, `src/engine/server-supervisor.js`, `src/engine/io.js`, `src/cli/terminal.js`, `src/cli/commands.js`, `src/cli/editor-input.js`
- *Imported by*: `agent.js`
- **startCLI** (async function)

### 📄 src/cli/commands.js (68 lines)
- *Imports*: `src/config.js`, `src/engine/session.js`, `src/engine/task-runner.js`, `src/engine/server-supervisor.js`, `src/project/history.js`, `src/project/project-map.js`, `src/project/rollback.js`
- *Imported by*: `src/cli/chat-loop.js`
- **COMMAND_NAMES** (const)
- **handleCommand** (async function)

### 📄 src/cli/editor-input.js (31 lines)
- *Imported by*: `src/cli/chat-loop.js`
- **readPromptViaEditor** (function)

### 📄 src/cli/terminal.js (40 lines)
- *Imported by*: `agent.js`, `src/cli/chat-loop.js`
- **ask** (function)
- **askConfirm** (async function)
- **closeTerminal** (function)

### 📄 src/config.js (38 lines)
- *Imported by*: `agent.js`, `src/cli/chat-loop.js`, `src/cli/commands.js`, `src/engine/routing.js`, `src/engine/task-runner.js`, `src/project/file-manager.js`, `src/project/project-map.js`, `src/project/projects.js`, `src/project/rollback.js`, `src/project/state-paths.js`, `tests/engine.test.js`, `tests/task-runner.test.js`
- **AGENT_ROOT** (const)
- **config** (const)
- **setTargetProject** (function)

### 📄 src/engine/checks.js (20 lines)
- *Imports*: `src/engine/linter.js`, `src/engine/tester.js`
- *Imported by*: `src/engine/patch-pipeline.js`
- **runProjectChecks** (async function)

### 📄 src/engine/command-runner.js (64 lines)
- *Imports*: `src/engine/io.js`, `src/engine/session.js`
- *Imported by*: `src/engine/patch-pipeline.js`, `tests/engine.test.js`
- **normalizeCommand** (function): Normalizes a shell command: trims and collapses internal whitespace. - Kept as a pure function so tests can assert on it directly.
- **runCommands** (async function): Default runner: the command's output goes straight to the developer's terminal. */ - function runInShell(command, { cwd }) { - execSync(command, { cwd, stdio: 'inherit' }); - } - /** - Runs a batch of commands in the target directory. - - safe commands run automatically - - risky commands require explicit confirmation - - a failing command stops the batch - Every outcome is written to the session, so the model sees what happened.

### 📄 src/engine/context-builder.js (54 lines)
- *Imports*: `src/project/project-map.js`, `src/engine/routing.js`
- *Imported by*: `src/engine/task-runner.js`, `tests/project.test.js`
- **extractMentions** (function)
- **resolveMention** (function)
- **selectFiles** (async function)

### 📄 src/engine/dev-server.js (118 lines)
- *Imports*: `src/project/state-paths.js`
- *Imported by*: `src/engine/server-supervisor.js`
- **runDevServer** (function)
- **stopDevServer** (function)

### 📄 src/engine/executor.js (23 lines)
- *Imports*: `src/llm/index.js`, `src/llm/translate.js`
- *Imported by*: `src/engine/task-runner.js`
- **askForJson** (async function)
- **askAgent** (async function)

### 📄 src/engine/io.js (13 lines)
- *Imported by*: `src/cli/chat-loop.js`, `src/engine/command-runner.js`, `tests/engine.test.js`, `tests/task-runner.test.js`
- **setConfirmHandler** (function)
- **confirm** (function)

### 📄 src/engine/linter.js (67 lines)
- *Imports*: `src/project/state-paths.js`
- *Imported by*: `src/engine/checks.js`, `tests/engine.test.js`
- **runLinter** (async function): Runs ESLint in the target project if it is installed and configured. - Missing ESLint / config are warnings, not code errors.

### 📄 src/engine/patch-pipeline.js (46 lines)
- *Imports*: `src/project/patcher.js`, `src/engine/command-runner.js`, `src/engine/checks.js`
- *Imported by*: `src/engine/task-runner.js`
- **runPatch** (async function)

### 📄 src/engine/prompt.js (53 lines)
- *Imported by*: `src/engine/task-runner.js`
- **buildPrompt** (function)

### 📄 src/engine/routing.js (55 lines)
- *Imports*: `src/config.js`, `src/llm/index.js`, `src/llm/translate.js`, `src/project/project-map.js`, `src/engine/session.js`
- *Imported by*: `src/engine/context-builder.js`
- **determineRelevantFiles** (async function)

### 📄 src/engine/server-supervisor.js (34 lines)
- *Imports*: `src/engine/dev-server.js`
- *Imported by*: `src/cli/chat-loop.js`, `src/cli/commands.js`, `src/engine/task-runner.js`
- **startSupervisedServer** (function)
- **restartSupervisedServer** (function)

### 📄 src/engine/session.js (74 lines)
- *Imports*: `src/project/state-paths.js`, `src/llm/index.js`
- *Imported by*: `src/cli/chat-loop.js`, `src/cli/commands.js`, `src/engine/command-runner.js`, `src/engine/routing.js`, `src/engine/task-runner.js`, `tests/task-runner.test.js`
- **initSession** (function)
- **getSession** (function)
- **appendToSession** (function)
- **clearSession** (function)
- **compressSessionIfNeeded** (async function)

### 📄 src/engine/task-runner.js (164 lines)
- *Imports*: `src/config.js`, `src/project/state-paths.js`, `src/project/file-manager.js`, `src/engine/session.js`, `src/engine/context-builder.js`, `src/engine/prompt.js`, `src/engine/executor.js`, `src/engine/patch-pipeline.js`, `src/engine/server-supervisor.js`
- *Imported by*: `src/cli/chat-loop.js`, `src/cli/commands.js`, `tests/task-runner.test.js`
- **processAgentTask** (async function)

### 📄 src/engine/tester.js (33 lines)
- *Imports*: `src/project/state-paths.js`
- *Imported by*: `src/engine/checks.js`, `tests/engine.test.js`
- **runTests** (function)

### 📄 src/llm/index.js (19 lines)
- *Imports*: `core/llm.js`
- *Imported by*: `src/engine/executor.js`, `src/engine/routing.js`, `src/engine/session.js`, `src/project/history.js`, `tests/engine.test.js`
- **ai** (re-export)
- **ask** (re-export)
- **askModel** (re-export)
- **askLocal** (re-export)
- **fallbackChain** (re-export)
- **modelForTier** (re-export)
- **translateToEnglish** (re-export)
- **translateToRussianIfEnglish** (re-export)
- **pickProvider** (re-export)
- **isLocalModel** (re-export)
- **parseModelJson** (re-export)
- **parseModelJsonObject** (re-export)
- **parseModelJsonArray** (re-export)

### 📄 src/llm/translate.js (7 lines)
- *Imports*: `core/llm.js`
- *Imported by*: `src/engine/executor.js`, `src/engine/routing.js`
- **translateToEnglish** (re-export)
- **translateToRussianIfEnglish** (re-export)

### 📄 src/project/backups.js (48 lines)
- *Imported by*: `src/project/patcher.js`, `src/project/rollback.js`
- **BACKUP_NAME_RE** (const)
- **encodeBackupName** (function)
- **decodeBackupName** (function)
- **newBackupPath** (function)
- **readCreated** (function)
- **writeCreated** (function)
- **hasBackup** (function)
- **moveBackupsTo** (function)

### 📄 src/project/editor.js (10 lines)
- *Imported by*: `src/project/patcher.js`, `src/project/rollback.js`
- **openInEditor** (function)

### 📄 src/project/file-manager.js (88 lines)
- *Imports*: `src/config.js`
- *Imported by*: `src/engine/task-runner.js`, `src/project/project-map.js`, `tests/patcher.test.js`, `tests/project.test.js`
- **listProjectFiles** (function)
- **readFilesContent** (function)

### 📄 src/project/history.js (38 lines)
- *Imports*: `src/llm/index.js`, `src/project/state-paths.js`
- *Imported by*: `src/cli/commands.js`
- **generateDocumentation** (async function)

### 📄 src/project/patcher.js (99 lines)
- *Imports*: `src/project/state-paths.js`, `src/project/backups.js`, `src/project/editor.js`, `src/project/project-map.js`
- *Imported by*: `src/engine/patch-pipeline.js`, `tests/patcher.test.js`
- **applyPatches** (async function)

### 📄 src/project/project-map.js (135 lines)
- *Imports*: `src/config.js`, `src/project/state-paths.js`, `src/project/file-manager.js`
- *Imported by*: `agent.js`, `src/cli/commands.js`, `src/engine/context-builder.js`, `src/engine/routing.js`, `src/project/patcher.js`, `tests/project.test.js`, `tests/task-runner.test.js`
- **analyzeFile** (function)
- **parseMapFiles** (function)
- **buildProjectMap** (function)
- **readProjectMap** (function)
- **ensureProjectMap** (function)

### 📄 src/project/projects.js (37 lines)
- *Imports*: `src/config.js`
- *Imported by*: `agent.js`, `tests/project.test.js`
- **PROJECTS_DIR** (const)
- **listProjects** (function)
- **resolveProject** (function)
- **projectPath** (function)

### 📄 src/project/rollback.js (132 lines)
- *Imports*: `src/config.js`, `src/project/state-paths.js`, `src/project/backups.js`, `src/project/editor.js`
- *Imported by*: `src/cli/commands.js`, `tests/patcher.test.js`
- **abortSessionPatches** (async function)
- **applyRedoPatches** (async function)
- **clearSessionBackups** (function)

### 📄 src/project/state-paths.js (25 lines)
- *Imports*: `src/config.js`
- *Imported by*: `agent.js`, `src/engine/dev-server.js`, `src/engine/linter.js`, `src/engine/session.js`, `src/engine/task-runner.js`, `src/engine/tester.js`, `src/project/history.js`, `src/project/patcher.js`, `src/project/project-map.js`, `src/project/rollback.js`, `tests/patcher.test.js`, `tests/project.test.js`, `tests/task-runner.test.js`
- **STATE_DIR_NAME** (const)
- **getStatePaths** (function)

### 📄 tests/engine.test.js (74 lines)
- *Imports*: `src/config.js`, `src/llm/index.js`, `src/engine/command-runner.js`, `src/engine/io.js`, `src/engine/linter.js`, `src/engine/tester.js`
- *Role*: Entry point / Controller / Service / Test
- (Internal logic / No exported functions)

### 📄 tests/patcher.test.js (108 lines)
- *Imports*: `src/project/patcher.js`, `src/project/rollback.js`, `src/project/file-manager.js`, `src/project/state-paths.js`
- *Role*: Entry point / Controller / Service / Test
- **a** (const)
- **t** (const)
- **a** (const)
- **x** (const)
- **a** (const)
- **a** (const)
- **a** (const)
- **extra** (function)
- **a** (const)
- **t** (const)
- **n** (const)
- **n** (const)
- **a** (const)
- **t** (const)
- **a** (const)
- **n** (const)
- **a** (const)
- **a** (const)
- **a** (const)
- **a** (const)
- **a** (const)

### 📄 tests/project.test.js (80 lines)
- *Imports*: `src/project/projects.js`, `src/project/file-manager.js`, `src/project/project-map.js`, `src/project/state-paths.js`, `src/engine/context-builder.js`
- *Role*: Entry point / Controller / Service / Test
- **add** (function)
- **run** (function)
- **stop** (function)
- **default** (default export)

### 📄 tests/task-runner.test.js (119 lines)
- *Imports*: `src/config.js`, `src/engine/task-runner.js`, `src/engine/session.js`, `src/engine/io.js`, `src/project/project-map.js`, `src/project/state-paths.js`
- *Role*: Entry point / Controller / Service / Test
- **a** (const)
- **hello** (function)
- **a** (const)
- **hello** (function)
- **multiply** (const)
- **hello** (function)
- **v** (const)
- **a** (const)

