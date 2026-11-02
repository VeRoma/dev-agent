import { config } from '../config.js';
import { initSession } from '../engine/session.js';
import { processAgentTask } from '../engine/task-runner.js';
import { stopDevServer } from '../engine/server-supervisor.js';
import { setConfirmHandler } from '../engine/io.js';
import { ask, askConfirm, closeTerminal } from './terminal.js';
import { handleCommand } from './commands.js';
import { readPromptViaEditor } from './editor-input.js';

async function chatLoop() {
    while (true) {
        const answer = await ask('\n>> ');
        if (answer === null) break; // ввод закрыт

        let text = answer.trim();

        if (['exit', 'quit'].includes(text.toLowerCase())) {
            console.log('⚙️ [SYSTEM] Агент отключается. До связи!');
            stopDevServer();
            break;
        }

        if (text === '/editor') {
            text = readPromptViaEditor();
            if (!text) continue;
        }
        if (!text) continue;

        try {
            if (text.startsWith('/')) await handleCommand(text);
            else await processAgentTask(text);
        } catch (error) {
            // Ошибка одной команды не должна убивать весь цикл
            console.error('\n❌ [ERROR] Неожиданная ошибка:', error.message);
        }
    }
    closeTerminal();
}

/** Точка входа интерфейса: разовая задача (Telegram) или интерактивный чат. */
export async function startCLI(initialTask = null) {
    console.log('\n⚙️ [SYSTEM] Dev-Agent CLI initialized!');
    console.log(`⚙️ [SYSTEM] Executor: ${config.llm.executorModel}`);
    console.log(`⚙️ [SYSTEM] Target Project: ${config.workspace.targetProject}`);

    setConfirmHandler(askConfirm);
    initSession('Dev-Agent Operation (General)');

    if (initialTask) {
        console.log('⚙️ [SYSTEM] Обрабатываю внешнюю задачу...\n');
        await processAgentTask(initialTask);
        process.exit(0);
    }
    await chatLoop();
}
