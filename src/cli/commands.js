import { config } from '../config.js';
import { getSession, clearSession, initSession } from '../engine/session.js';
import { processAgentTask } from '../engine/task-runner.js';
import { startSupervisedServer, stopDevServer } from '../engine/server-supervisor.js';
import { generateDocumentation } from '../project/history.js';
import { buildProjectMap } from '../project/project-map.js';
import { abortSessionPatches, applyRedoPatches, clearSessionBackups } from '../project/rollback.js';
import { resolveProject } from '../project/projects.js';
import { SELF_PROJECT } from '../project/self-workspace.js';
import { openProject } from './project-setup.js';

/** Switches the target project in a running session; on failure the current project stays. */
function switchProject(selector) {
    const name = resolveProject(selector);
    if (!name) {
        console.log('\n⚠️ Такого проекта нет. Пример: /p 3, /p имя-проекта, /p self');
        return;
    }
    stopDevServer();
    try {
        openProject(name);
    } catch (error) {
        console.log(`\n❌ [ERROR] ${error.message}`);
        return;
    }
    initSession(`Project: ${name}`);
}

const DEFAULT_AUDIT_TASK =
    'Проведи полный архитектурный и security-аудит проекта. Найди мёртвые файлы, сломанные импорты, ' +
    'несовместимость модулей, дыры в безопасности (секреты в коде, инъекции, небезопасные команды) и рассинхрон логики. ' +
    'Выдай подробный структурный отчёт в режиме chat; ничего не меняй без отдельной задачи.';

const COMMANDS = {
    // "/audit" or "/audit <custom focus>": never handed to the fast tier
    '/audit': async (args) => {
        console.log('\n🔭 Запуск полного аудита проекта...');
        buildProjectMap();
        await processAgentTask(args || DEFAULT_AUDIT_TASK, 0, [], { forceFullAudit: true });
    },

    '/p': async (args) => switchProject(args),
    '/self': async () => switchProject(SELF_PROJECT),

    '/run': async () => startSupervisedServer(config.workspace.targetProject, processAgentTask),
    '/stop': async () => stopDevServer(),

    '/save': async () => {
        console.log('\n💾 Starting save process...');
        await generateDocumentation(config.workspace.targetProject, getSession());
        buildProjectMap();
        clearSession();
        clearSessionBackups();
        initSession('New task (waiting...)');
        console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
    },

    '/index': async () => {
        console.log('\n🗺️ Генерация карты проекта (мгновенно, без LLM)...');
        buildProjectMap();
    },

    '/abort': async () => {
        console.log('\n🗑️ Aborting current task...');
        await abortSessionPatches();
        clearSession();
        initSession('Task aborted (waiting...)');
        console.log('🛑 Task aborted. AI memory erased. Files reverted.');
    },

    '/redo': async () => {
        console.log('\n🔄 Restoring aborted task...');
        if (await applyRedoPatches()) {
            console.log('⏩ Task restored. AI memory reloaded. Files reverted to modified state.');
        }
    },

    '/clear': async () => {
        clearSession();
        initSession('Context cleared');
        console.log("\n🧹 AI memory cleared. Let's start a fresh topic!");
    },

    '/push': async () => {
        console.log('\n🚀 Preparing release...');
        console.log('   [To be implemented: generate commit message -> git add, commit, push]');
    },
};

export const COMMAND_NAMES = ['/editor', ...Object.keys(COMMANDS)];

/** Handles a slash command ("/name [arguments]"). An unknown command prints the help. */
export async function handleCommand(text) {
    const [name, ...rest] = text.trim().split(/\s+/);
    const handler = COMMANDS[name.toLowerCase()];
    if (!handler) {
        console.log(`\n⚠️ Unknown command. Available: ${COMMAND_NAMES.join(', ')}`);
        return;
    }
    await handler(rest.join(' '));
}
