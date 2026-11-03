// Fixture and grading helpers shared by the eval runner and its offline test (tests/evals.test.js).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { BASE_FILES } from './tasks.js';
import { cleanTestEnv } from '../src/engine/tester.js';

const SKIP_DIRS = new Set(['.git', '.dev-agent', 'node_modules', '__eval__']);
const EXECUTOR_TIERS = ['fast', 'pro', 'arch'];

export function writeFiles(root, files) {
    for (const [rel, content] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}

const git = (dir, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf-8' });

/** A committed fixture project in the OS temp dir: "changed" = what the agent did. */
export function createFixture(task) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dev-agent-eval-${task.id}-`));
    writeFiles(dir, { ...BASE_FILES, ...task.files });
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'fixture');
    return dir;
}

/** Grading helpers over the fixture after the agent finished. Call before copying hidden tests in. */
export function makeHelpers(dir, session) {
    const listFiles = (rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : listFiles(child);
        return [child];
    });
    const changed = git(dir, 'status', '--porcelain', '--untracked-files=all')
        .split('\n').filter(Boolean)
        .map(line => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
    return {
        dir,
        session,
        changed,
        listFiles: () => listFiles(),
        exists: (rel) => fs.existsSync(path.join(dir, rel)),
        read: (rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), 'utf-8') : ''),
        diffStat(rel) {
            const [added = 0, removed = 0] = git(dir, 'diff', '--numstat', '--ignore-cr-at-eol', '--', rel).trim().split(/\s+/).map(Number);
            return { added: added || 0, removed: removed || 0 };
        },
        runTests() {
            const r = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf-8', env: cleanTestEnv() });
            return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
        },
    };
}

/** Hidden tests go in only after the agent finished. */
export async function grade(task, dir, session) {
    const h = makeHelpers(dir, session);
    if (task.hidden) writeFiles(path.join(dir, '__eval__'), task.hidden);
    return task.check(h);
}

const OUTCOMES = [
    ['[PATCH APPLIED SUCCESSFULLY]', 'patch ok'],
    ['[TASK COMPLETED]', 'completed'],
    ['[PATCH REJECTED]', 'rejected'],
    ['FAILED]:', 'checks failed'],
];

/** The agent's own view of the result: the last outcome marker in the session. */
export function agentOutcome(session = '') {
    let best = { at: -1, name: 'chat' };
    for (const [marker, name] of OUTCOMES) {
        const at = session.lastIndexOf(marker);
        if (at > best.at) best = { at, name };
    }
    return best.name;
}

/** Per-task numbers from the usage records (ai-core onUsage). */
export function metrics(usage, pricing = {}) {
    const executor = usage.filter(u => EXECUTOR_TIERS.includes(u.label.split(' ')[0]));
    let cost = 0;
    let priced = true;
    for (const u of usage) {
        const price = pricing[u.model];
        if (price) cost += ((u.inputTokens ?? 0) * price.input + (u.outputTokens ?? 0) * price.output) / 1e6;
        else if ((u.inputTokens ?? 0) + (u.outputTokens ?? 0) > 0) priced = false;
    }
    const sum = (list, key) => list.reduce((s, u) => s + (u[key] ?? 0), 0);
    return {
        calls: usage.length,
        failedCalls: usage.filter(u => !u.ok).length,
        executorCalls: executor.length,
        fixes: executor.filter(u => u.label.includes('fix')).length,
        tiers: [...new Set(executor.map(u => u.label.split(' ')[0]))],
        inputTokens: sum(usage, 'inputTokens'),
        outputTokens: sum(usage, 'outputTokens'),
        executorOutputTokens: sum(executor, 'outputTokens'),
        cost,
        priced,
    };
}
