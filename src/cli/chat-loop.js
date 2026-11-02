import { config } from '../config.js';
import { initSession } from '../engine/session.js';
import { processAgentTask } from '../engine/task-runner.js';
import { stopDevServer } from '../engine/server-supervisor.js';
import { setConfirmHandler, setExclusiveRunner } from '../engine/io.js';
import { askConfirm, onInputLine, showPrompt, closeTerminal } from './terminal.js';
import { handleCommand } from './commands.js';
import { readPromptViaEditor } from './editor-input.js';
import { classifyExternalTask, EXTERNAL_COMMANDS } from './external-task.js';

let busy = false; // агент выполняет задачу (из чата или авто-исправление после падения)

/** Задача агента: никогда не две одновременно; после неё снова приглашение. */
async function runExclusive(task) {
    if (busy) return false;
    busy = true;
    try {
        await task();
    } catch (error) {
        // Ошибка одной задачи не должна убивать весь цикл
        console.error('\n❌ [ERROR] Неожиданная ошибка:', error.message);
    } finally {
        busy = false;
        showPrompt();
    }
    return true;
}

async function handleInput(text) {
    if (text === '/editor') {
        const editorText = readPromptViaEditor();
        if (editorText) await processAgentTask(editorText);
    } else if (text.startsWith('/')) {
        await handleCommand(text);
    } else {
        await processAgentTask(text);
    }
}

function chatLoop() {
    return new Promise((resolve) => {
        onInputLine((line) => {
            const text = line.trim();

            if (['exit', 'quit'].includes(text.toLowerCase())) {
                console.log('⚙️ [SYSTEM] Агент отключается. До связи!');
                stopDevServer();
                closeTerminal();
                return;
            }
            if (busy) {
                if (text) console.log('⏳ Агент занят текущей задачей. Дождитесь завершения (или exit для выхода).');
                return;
            }
            if (!text) {
                showPrompt();
                return;
            }
            runExclusive(() => handleInput(text));
        }, resolve); // ввод закрыт (exit, Ctrl+D, конец потока)
        showPrompt();
    });
}

/** Interface entry point: a one-off task (Telegram) or the interactive chat. */
export async function startCLI(initialTask = null) {
    const { tiers = {} } = config.llm;
    console.log('\n⚙️ [SYSTEM] Dev-Agent CLI initialized!');
    console.log(`⚙️ [SYSTEM] Executors: fast=${tiers.fast}, pro=${tiers.pro}, arch=${tiers.arch}`);
    console.log(`⚙️ [SYSTEM] Target Project: ${config.workspace.targetProject}`);

    setConfirmHandler(askConfirm);
    setExclusiveRunner(runExclusive);
    initSession('Dev-Agent Operation (General)');

    if (initialTask) {
        console.log('⚙️ [SYSTEM] Обрабатываю внешнюю задачу...\n');
        const kind = classifyExternalTask(initialTask);
        if (kind === 'command') await handleCommand(initialTask.trim());
        else if (kind === 'task') await processAgentTask(initialTask);
        else console.log(`⛔ Команда недоступна без терминала. Можно: ${EXTERNAL_COMMANDS.join(', ')} или текст задачи.`);
        process.exit(0);
    }
    await chatLoop();
}
