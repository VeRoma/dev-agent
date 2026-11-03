import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { TASKS } from '../evals/tasks.js';
import { createFixture, grade, writeFiles, agentOutcome, metrics } from '../evals/harness.js';

// Offline: no agent, no network. Proves every eval is meaningful (the untouched fixture fails)
// and satisfiable (the reference solution passes), so a red eval means the agent, not the grader.
const ANSWERED = '\n🤖 **Агент:** ответ\n';
const failed = (checks) => checks.filter(c => !c.ok).map(c => c.msg).join('; ');

for (const task of TASKS) {
    test(`eval ${task.id}: fails untouched (unless "do nothing" is the answer), passes with the reference solution`, async () => {
        const untouched = createFixture(task);
        const solved = createFixture(task);
        try {
            const before = await grade(task, untouched, '');
            const doNothingIsRight = Object.keys(task.solution).length === 0 && task.id !== 'question-no-edit';
            assert.equal(before.every(c => c.ok), doNothingIsRight, `untouched fixture: ${failed(before) || 'all checks passed'}`);

            writeFiles(solved, task.solution);
            const after = await grade(task, solved, ANSWERED);
            assert.ok(after.every(c => c.ok), `reference solution: ${failed(after)}`);
        } finally {
            fs.rmSync(untouched, { recursive: true, force: true });
            fs.rmSync(solved, { recursive: true, force: true });
        }
    });
}

test('eval refuse-destructive: deleting .env is caught', async () => {
    const task = TASKS.find(t => t.id === 'refuse-destructive');
    const dir = createFixture(task);
    try {
        fs.rmSync(`${dir}/.env`);
        assert.equal((await grade(task, dir, '')).every(c => c.ok), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('eval metrics: executor calls, fixes, tiers, cost; outcome = last session marker', () => {
    const usage = [
        { label: 'orchestrator', model: 'g-pro', ok: true, inputTokens: 1000, outputTokens: 100 },
        { label: 'fast', model: 'ds', ok: true, inputTokens: 2000, outputTokens: 500 },
        { label: 'fast fix', model: 'ds', ok: false, inputTokens: null, outputTokens: null },
        { label: 'pro fix', model: 'g-pro', ok: true, inputTokens: 3000, outputTokens: 700 },
    ];
    const m = metrics(usage, { 'g-pro': { input: 2, output: 12 } });
    assert.deepEqual([m.calls, m.failedCalls, m.executorCalls, m.fixes], [4, 1, 3, 2]);
    assert.deepEqual(m.tiers, ['fast', 'pro']);
    assert.equal(m.executorOutputTokens, 1200);
    assert.equal(m.priced, false, 'ds has tokens but no price');
    assert.ok(Math.abs(m.cost - (4000 * 2 + 800 * 12) / 1e6) < 1e-12);

    assert.equal(agentOutcome('[PATCH APPLIED WITH ERRORS]: a\n[PATCH APPLIED SUCCESSFULLY]: b'), 'patch ok');
    assert.equal(agentOutcome('[PATCH APPLIED SUCCESSFULLY]: a\n[PATCH APPLIED BUT TESTS FAILED]: b'), 'checks failed');
    assert.equal(agentOutcome('just talk'), 'chat');
});
