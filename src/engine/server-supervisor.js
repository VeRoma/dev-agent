import { runDevServer, stopDevServer } from './dev-server.js';

const CRASH_PROMPT = '[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и сгенерируй патч с исправлением кода:';

// Пока идёт авто-исправление, новые падения игнорируются (иначе правки пошли бы параллельно)
let fixInProgress = false;

/**
 * Запускает целевой проект и при падении отдаёт лог агенту на исправление.
 * @param {(prompt: string) => Promise<void>} runTask обычно processAgentTask (передаётся снаружи: нет циклического импорта)
 */
export function startSupervisedServer(targetProject, runTask, onIdle = () => {}) {
    runDevServer(targetProject, async (errorLog) => {
        if (fixInProgress) return;
        fixInProgress = true;
        try {
            console.log('\n🚨 ВНИМАНИЕ: Целевой процесс упал с ошибкой! Передаю на авто-исправление...');
            await runTask(`${CRASH_PROMPT}\n\n${String(errorLog).slice(-4000)}`);
            console.log('\n✅ Попытка исправления завершена. Посмотрите логи процесса выше.');
        } finally {
            fixInProgress = false;
            onIdle();
        }
    });
}

export function restartSupervisedServer(targetProject, runTask, onIdle) {
    console.log('\n🔄 Агент автономно перезапускает целевой процесс...');
    stopDevServer();
    startSupervisedServer(targetProject, runTask, onIdle);
}

export { stopDevServer };
