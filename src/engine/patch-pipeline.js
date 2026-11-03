import path from 'path';
import { execFileSync } from 'child_process';
import { applyPatches } from '../project/patcher.js';
import { runCommands, isTestCommand } from './command-runner.js';
import { runProjectChecks } from './checks.js';
import { appendToSession } from './session.js';

const isGitRecordCommand = (command) => /^\s*git\s+(add|commit)\b/.test(String(command));

/** True when the git index has nothing staged (a failed "git commit" then had nothing to do). */
function nothingStaged(cwd) {
    try {
        execFileSync('git', ['diff', '--cached', '--quiet'], { cwd, stdio: 'ignore' });
        return true;
    } catch {
        return false; // staged changes exist, or not a git repository
    }
}

/**
 * One "patch" pass: (git add/commit of the previous step) -> apply files -> run commands -> check the code.
 * Returns the outcome; the orchestrator decides whether to retry or stop.
 *
 * outcome:
 *   'empty'        — nothing to do in the response
 *   'rejected'     — the guard rejected the patch, nothing was written to disk
 *   'commit_failed' — the commit of the previous step failed or was declined, nothing was written
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
        // "nothing to commit" (the step was committed already) is not a failure: nothing is left behind
        const realFailures = failed.filter(f => !(/^\s*git\s+commit\b/.test(f.command) && nothingStaged(targetAbsolute)));
        if (realFailures.length > 0 || skipped.length > 0) {
            console.log('\n⏸️ Коммит предыдущего шага не выполнен — новые правки не применяю.');
            appendToSession('user', '[SYSTEM] The commit of the previous step did not run, so NONE of your file changes were written. Wait for the developer.');
            return { outcome: 'commit_failed' };
        }
        if (failed.length > 0) {
            console.log('ℹ️ Коммитить было нечего (шаг уже закоммичен) — продолжаю.');
            appendToSession('user', '[SYSTEM] "git commit" had nothing to commit: the previous step was already committed. Your file changes are being applied.');
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
