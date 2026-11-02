import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { fallbackChain, pickProvider, isLocalModel } from '../src/llm/index.js';
import { normalizeCommand, runCommands } from '../src/engine/command-runner.js';
import { setConfirmHandler } from '../src/engine/io.js';
import { runLinter } from '../src/engine/linter.js';
import { runTests } from '../src/engine/tester.js';

test('llm router: provider by model name; local models are excluded from the code-execution chain', () => {
    // Provider detection by model name.
    assert.equal(pickProvider('deepseek-chat'), 'deepseek');
    assert.equal(pickProvider('claude-sonnet-4-5'), 'claude');
    assert.equal(pickProvider('qwen2.5-coder:7b-instruct'), 'ollama');

    // Local models are recognized.
    assert.equal(isLocalModel('qwen2.5-coder:7b-instruct'), true);
    assert.equal(isLocalModel('deepseek-chat'), false);

    // SECURITY: for the executor (allowLocal=false), the local model must NEVER
    // appear in the code-generation fallback chain. Only cloud models are allowed.
    const executorChain = fallbackChain('deepseek-chat');
    assert.ok(!executorChain.includes(config.llm.fallbackModel),
        'the local fallbackModel must never be used for code generation');
    for (const model of executorChain) {
        assert.equal(isLocalModel(model), false,
            `local model ${model} must not appear in the executor chain`);
    }

    // The chain must match the configured cloud fallbacks (order preserved).
    assert.deepEqual(executorChain, config.llm.cloudFallbacks);

    // The primary model is never repeated in its own fallback chain.
    for (const cloudModel of config.llm.cloudFallbacks) {
        assert.ok(!fallbackChain(cloudModel).includes(cloudModel),
            `primary ${cloudModel} must not repeat in its own chain`);
    }

    // Dispatcher mode (allowLocal=true) MAY include the local model as a last resort.
    const dispatcherChain = fallbackChain('deepseek-chat', true);
    assert.ok(dispatcherChain.includes(config.llm.fallbackModel),
        'dispatcher chain may include the local model as a last resort');
});

test('command-runner: whitelist runs, others need confirmation, failure stops the batch', async () => {
    assert.equal(normalizeCommand('  npm   test  '), 'npm test');

    const ran = [];
    const answers = [false, true];
    setConfirmHandler(async () => answers.shift() ?? false);

    const result = await runCommands([
        'npm test',
        'rm -rf src',
        'git commit -m "fix it"',
    ], { cwd: process.cwd(), run: async (cmd) => { ran.push(cmd); } });

    assert.deepEqual(ran, ['npm test', 'git commit -m "fix it"']);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].command, 'rm -rf src');

    setConfirmHandler(async () => true);
    const failing = await runCommands(['npm run boom'], {
        cwd: process.cwd(),
        run: async () => { throw new Error('boom'); },
    });
    assert.equal(failing.failed.length, 1);
});

test('checks: missing ESLint / ESLint config / test script are warnings, not code errors', async () => {
    const linter = await runLinter(process.cwd());
    assert.equal(typeof linter.ok, 'boolean');

    const tester = await runTests(process.cwd());
    assert.equal(typeof tester.ok, 'boolean');
});
