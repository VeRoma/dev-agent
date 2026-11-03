import path from 'path';
import { applyPatches } from '../project/patcher.js';
import { runCommands, isTestCommand } from './command-runner.js';
import { runProjectChecks } from './checks.js';
import { appendToSession } from './session.js';

const isGitRecordCommand = (command) => /^\s*git\s+(add|commit)\b/.test(String(command));

/**
 * One "patch" pass: (git add/commit of the previous step) -> apply files -> run commands -> check the code.
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

    // git add/commit in the same reply commit the previous, already verified step: they run BEFORE the new files
    // are written, otherwise the commit would take the unchecked new changes along
    const changesFiles = toUpdate.length > 0 || toDelete.length > 0;
    const gitFirst = changesFiles ? commands.filter(isGitRecordCommand) : [];
    commands = commands.filter(c => !gitFirst.includes(c));
    if (gitFirst.length > 0) {
        const { failed, skipped } = await runCommands(gitFirst, { cwd: targetAbsolute });
        if (failed.length > 0 || skipped.length > 0) {
            console.log('\n⏸️ Коммит предыдущего шага не выполнен — новые правки не применяю.');
            appendToSession('user', '[SYSTEM] The commit of the previous step did not run, so NONE of your file changes were written. Wait for the developer.');
            return { outcome: 'completed' };
        }
    }

    if (changesFiles) {
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
