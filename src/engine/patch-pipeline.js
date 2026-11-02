import path from 'path';
import { applyPatches } from '../project/patcher.js';
import { runCommands } from './command-runner.js';
import { runProjectChecks } from './checks.js';

/**
 * Один проход «патч»: применить файлы -> выполнить команды -> проверить код.
 * Возвращает исход, а решение (повторить / остановиться) принимает оркестратор.
 *
 * outcome:
 *   'empty'        — в ответе нечего делать
 *   'rejected'     — защита отклонила патч, на диск ничего не записано
 *   'completed'    — изменений кода не было (аудит / только команды)
 *   'clean'        — патч применён, линтер и тесты прошли
 *   'check_failed' — патч применён, проверки нашли ошибки
 */
export async function runPatch(parsed, { targetProject, targetAbsolute }) {
    const toUpdate = parsed.filesToUpdate || [];
    const toDelete = parsed.filesToDelete || [];
    const commands = parsed.commandsToRun || [];

    if (toUpdate.length === 0 && toDelete.length === 0 && commands.length === 0) {
        return { outcome: 'empty' };
    }

    if (toUpdate.length > 0 || toDelete.length > 0) {
        const result = await applyPatches(targetProject, toUpdate, toDelete);
        if (result.rejected.length > 0) return { outcome: 'rejected', rejected: result.rejected };
    }

    if (commands.length > 0) await runCommands(commands, targetAbsolute);

    if (toUpdate.length === 0) return { outcome: 'completed' };

    console.log('\n🔍 Запуск проверки кода целевого проекта...');
    const check = await runProjectChecks(targetProject, toUpdate);
    if (check.success) return { outcome: 'clean' };

    return {
        outcome: 'check_failed',
        kind: check.kind,
        output: check.output,
        updatedPaths: toUpdate.map(f => path.resolve(targetAbsolute, f.path)),
    };
}
