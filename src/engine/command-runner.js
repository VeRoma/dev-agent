import { classifyCommand } from '../safety/command-guard.js';
import { confirm } from './io.js';
import { appendToSession } from './session.js';

/**
 * Normalizes a shell command: trims and collapses internal whitespace.
 * Kept as a pure function so tests can assert on it directly.
 */
export function normalizeCommand(command) {
    return String(command ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Runs a batch of commands in the target directory.
 * - safe commands run automatically
 * - risky commands require explicit confirmation
 * - a failing command stops the batch
 */
export async function runCommands(commands, { cwd, run } = {}) {
    const executed = [];
    const skipped = [];
    const failed = [];

    for (const raw of commands ?? []) {
        const command = normalizeCommand(raw);
        if (!command) continue;

        const verdict = classifyCommand(command);
        if (verdict.level !== 'safe') {
            const approved = await confirm(`Run command: ${command}?`);
            if (!approved) {
                skipped.push({ command, reason: verdict.reason });
                continue;
            }
        }

        try {
            await run(command, { cwd });
            executed.push(command);
        } catch (error) {
            failed.push({ command, error });
            appendToSession(`Command failed: ${command} -> ${error?.message ?? error}`);
            break;
        }
    }

    return { executed, skipped, failed };
}
