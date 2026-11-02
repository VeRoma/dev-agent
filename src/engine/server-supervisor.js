import { runDevServer, stopDevServer } from './dev-server.js';
import { confirm, runExclusive } from './io.js';

const CRASH_PROMPT = '[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и сгенерируй патч с исправлением кода:';

/**
 * Падение целевого процесса: с согласия разработчика (без терминала — сразу) агент пытается исправить код.
 * Пока агент занят другой задачей, исправление не запускается (правки не идут параллельно).
 * @param {(prompt: string) => Promise<void>} runTask обычно processAgentTask (передаётся снаружи: нет циклического импорта)
 */
export async function handleCrash(errorLog, runTask) {
    const started = await runExclusive(async () => {
        console.log('\n🚨 ВНИМАНИЕ: Целевой процесс упал с ошибкой!');
        const approved = await confirm('🔧 Передать лог агенту на авто-исправление? (y/N): ', { whenNoTerminal: true });
        if (!approved) {
            console.log('⏭️ Авто-исправление пропущено.');
            return;
        }
        await runTask(`${CRASH_PROMPT}\n\n${String(errorLog).slice(-4000)}`);
        console.log('\n✅ Попытка исправления завершена. Посмотрите логи процесса выше.');
    });
    if (!started) console.log('\n⚠️ Целевой процесс упал, но агент занят другой задачей — авто-исправление пропущено.');
}

/** Запускает целевой проект и при падении предлагает отдать лог агенту на исправление. */
export function startSupervisedServer(targetProject, runTask) {
    runDevServer(targetProject, (errorLog) => handleCrash(errorLog, runTask));
}

export function restartSupervisedServer(targetProject, runTask) {
    console.log('\n🔄 Агент автономно перезапускает целевой процесс...');
    stopDevServer();
    startSupervisedServer(targetProject, runTask);
}

export { stopDevServer };
