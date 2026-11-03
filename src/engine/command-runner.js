import { execSync } from 'child_process';
import { classifyCommand, projectChildEnv } from '@veroma/ai-core/safety';
import { confirm } from './io.js';
import { appendToSession } from './session.js';

/**
 * Normalizes a shell command: trims and collapses internal whitespace.
 * Kept as a pure function so tests can assert on it directly.
 */
export function normalizeCommand(command) {
    return String(command ?? '').trim().replace(/\s+/g, ' ');
}

/** Test-suite runs (npm, node --test, Maven); after a code change the post-patch checks run the tests anyway. */
export function isTestCommand(command) {
    const cmd = normalizeCommand(command);
    return /^(npm (test|t|run test)|node --test)(\s|$)/.test(cmd)
        || /^(\.[\\/])?(mvnw(\.cmd)?|mvn)\b.*\btest\b/.test(cmd)
        || /^cd \S+ && (\.[\\/])?(mvnw(\.cmd)?|mvn)\b.*\btest\b/.test(cmd);
}

/** Default runner: the command's output goes straight to the developer's terminal; the agent's secrets stay out of its env. */
function runInShell(command, { cwd }) {
    execSync(command, { cwd, stdio: 'inherit', env: projectChildEnv().env });
}

/**
 * Runs a batch of commands in the target directory.
 * - safe commands run automatically
 * - risky commands require explicit confirmation
 * - a failing command stops the batch
 * Every outcome is written to the session, so the model sees what happened.
 * @param {string[]} commands
 * @param {{cwd: string, run?: (command: string, opts: {cwd: string}) => any}} options
 */
export async function runCommands(commands, { cwd, run = runInShell } = {}) {
    const executed = [];
    const skipped = [];
    const failed = [];

    for (const raw of commands ?? []) {
        const command = normalizeCommand(raw);
        if (!command) continue;
        console.log(`\n   > ${command}`);

        const verdict = classifyCommand(command);
        if (verdict.level !== 'safe') {
            const risk = verdict.warning ? ` (риск: ${verdict.warning})` : '';
            const approved = await confirm(`🛡️ Команда вне белого списка${risk}. Выполнить «${command}»? (y/N): `);
            if (!approved) {
                console.log('⛔ Команда пропущена.');
                skipped.push({ command, reason: verdict.warning });
                appendToSession('agent', `[COMMAND DENIED]: ${command}`);
                continue;
            }
        }

        try {
            await run(command, { cwd });
            executed.push(command);
            appendToSession('agent', `[COMMAND EXECUTED]: ${command}`);
        } catch (error) {
            console.log('❌ Command failed.');
            failed.push({ command, error });
            appendToSession('agent', `[COMMAND FAILED]: ${command}\nError: ${error?.message ?? error}`);
            break;
        }
    }

    return { executed, skipped, failed };
}
