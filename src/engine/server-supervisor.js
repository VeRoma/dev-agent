import { runDevServer, stopDevServer } from './dev-server.js';
import { confirm, runExclusive } from './io.js';
import { isSelfWorktree } from '../project/self-workspace.js';

const CRASH_PROMPT = '[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и сгенерируй патч с исправлением кода:';

/**
 * Target process crash: with the developer's consent (no terminal: right away) the agent tries to fix the code.
 * While the agent is busy with another task the fix is not started (edits never run in parallel).
 * @param {(prompt: string) => Promise<void>} runTask usually processAgentTask (passed in: avoids a circular import)
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

/** Runs the target project; on a crash offers the log to the agent for fixing. Never runs the agent's own worktree. */
export function startSupervisedServer(targetProject, runTask) {
    if (isSelfWorktree(targetProject)) {
        console.log('\n⚠️ В режиме self проект не запускается: это была бы копия самого агента. Проверка правок — тесты worktree.');
        return;
    }
    runDevServer(targetProject, (errorLog) => handleCrash(errorLog, runTask));
}

export function restartSupervisedServer(targetProject, runTask) {
    console.log('\n🔄 Агент автономно перезапускает целевой процесс...');
    stopDevServer({ quiet: true });
    startSupervisedServer(targetProject, runTask);
}

export { stopDevServer };
