import path from 'path';
import { applyPatches } from '../project/patcher.js';
import { runCommands, isTestCommand } from './command-runner.js';
import { runProjectChecks } from './checks.js';

/**
 * One "patch" pass: apply files -> run commands -> check the code.
 * Returns the outcome; the orchestrator decides whether to retry or stop.
 *
 * outcome:
 *   'empty'        — nothing to do in the response
 *   'rejected'     — the guard rejected the patch, nothing was written to disk
 *   'completed'    — no code changes (audit / commands only)
 *   'clean'        — patch applied, linter and tests passed
 *   'check_failed' — patch applied, checks found errors
 */
export async function runPatch(parsed, { targetProject, targetAbsolute }) {
    const toUpdate = parsed.filesToUpdate || [];
    const toDelete = parsed.filesToDelete || [];
    let commands = parsed.commandsToRun || [];

    if (toUpdate.length === 0 && toDelete.length === 0 && commands.length === 0) {
        return { outcome: 'empty' };
    }

    if (toUpdate.length > 0 || toDelete.length > 0) {
        const result = await applyPatches(targetProject, toUpdate, toDelete);
        if (result.rejected.length > 0) return { outcome: 'rejected', rejected: result.rejected };
    }

    // The checks below run the tests after a code change: do not run them twice
    if (toUpdate.length > 0) {
        const tests = commands.filter(isTestCommand);
        if (tests.length > 0) {
            console.log(`\n⏭️ Пропускаю ${tests.map(c => `«${c}»`).join(', ')}: тесты запустятся в проверке после патча.`);
            commands = commands.filter(c => !isTestCommand(c));
        }
    }

    if (commands.length > 0) await runCommands(commands, { cwd: targetAbsolute });

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
