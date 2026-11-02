import { config } from '../config.js';
import { getSession, clearSession, initSession } from '../engine/session.js';
import { processAgentTask } from '../engine/task-runner.js';
import { startSupervisedServer, stopDevServer } from '../engine/server-supervisor.js';
import { generateDocumentation } from '../project/history.js';
import { buildProjectMap } from '../project/project-map.js';
import { abortSessionPatches, applyRedoPatches, clearSessionBackups } from '../project/rollback.js';

const COMMANDS = {
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

/** Обрабатывает слэш-команду. Неизвестная команда выводит справку. */
export async function handleCommand(text) {
    const handler = COMMANDS[text.toLowerCase()];
    if (!handler) {
        console.log(`\n⚠️ Unknown command. Available: ${COMMAND_NAMES.join(', ')}`);
        return;
    }
    await handler();
}
