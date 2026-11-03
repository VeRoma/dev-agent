import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config, setTargetProject } from '../src/config.js';
import { fallbackChain, pickProvider, isLocalModel } from '../src/llm/index.js';
import { normalizeCommand, runCommands, isTestCommand } from '../src/engine/command-runner.js';
import { setConfirmHandler } from '../src/engine/io.js';
import { runLinter } from '../src/engine/linter.js';
import { runTests, findMavenModules } from '../src/engine/tester.js';

// Commands log to the session of the selected project: a temp one, never a real project
setTargetProject(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-engine-')));

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
    // Dispatcher mode (allowLocal=true, local last resort) depends on llm.fallbackModel,
    // which this config does not set; the rule itself is tested in @veroma/ai-core.
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

test('command-runner: test-suite commands are recognized (post-patch checks run them anyway)', () => {
    for (const cmd of ['npm test', '  npm   test ', 'npm t', 'npm run test', 'npm test -- --watch=false', 'node --test', 'node --test tests/a.test.js']) {
        assert.equal(isTestCommand(cmd), true, cmd);
    }
    for (const cmd of ['npm install', 'npm run test:e2e', 'npm run lint', 'node --check src/a.js', 'npm tests']) {
        assert.equal(isTestCommand(cmd), false, cmd);
    }
});

test('tester: a failing project test is reported even when the agent itself runs under node --test', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-failing-'));
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
        fs.writeFileSync(path.join(dir, 'a.test.js'), "import test from 'node:test';\ntest('x', () => { throw new Error('boom'); });\n");
        assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: running under node --test');
        assert.equal((await runTests(dir)).ok, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('tester: Maven modules are found from the changed files (nearest pom.xml)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-mvn-'));
    try {
        fs.mkdirSync(path.join(root, 'backend/src/main/java'), { recursive: true });
        fs.writeFileSync(path.join(root, 'backend/pom.xml'), '<project/>');
        fs.mkdirSync(path.join(root, 'frontend/src'), { recursive: true });
        assert.deepEqual(findMavenModules(root, [{ path: 'backend/src/main/java/A.java' }, 'backend/src/test/B.java', 'frontend/src/a.js']), ['backend']);
        assert.deepEqual(findMavenModules(root, ['frontend/src/a.js', '../outside/A.java']), []);
        fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
        assert.deepEqual(findMavenModules(root, ['tools/X.java']), ['']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('tester: Maven tests run through the wrapper, failures are reported, the agent secrets never reach them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-mvnw-'));
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'agent-bot-token-must-not-leak';
    const writeWrapper = (exitCode) => {
        fs.writeFileSync(path.join(root, 'backend/mvnw.cmd'),
            `@echo off\r\necho [INFO] Building\r\necho [ERROR] Tests run: 3, Failures: ${exitCode} TOKEN=%TELEGRAM_BOT_TOKEN% ARGS=%*\r\nexit /b ${exitCode}\r\n`);
        fs.writeFileSync(path.join(root, 'backend/mvnw'),
            `#!/bin/sh\necho "[INFO] Building"\necho "[ERROR] Tests run: 3, Failures: ${exitCode} TOKEN=$TELEGRAM_BOT_TOKEN ARGS=$*"\nexit ${exitCode}\n`, { mode: 0o755 });
    };
    try {
        fs.mkdirSync(path.join(root, 'backend/src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'backend/pom.xml'), '<project/>');

        writeWrapper(1);
        const failed = await runTests(root, ['backend/src/A.java']);
        assert.equal(failed.ok, false);
        assert.match(failed.output, /Tests run: 3, Failures: 1/);
        assert.match(failed.output, /ARGS=-B test/);
        assert.ok(!failed.output.includes('agent-bot-token-must-not-leak'), 'the agent bot token must not reach project tests');

        writeWrapper(0);
        assert.equal((await runTests(root, ['backend/src/A.java'])).ok, true);
    } finally {
        if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = saved;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('command-runner: Maven test runs count as test commands', () => {
    for (const c of ['mvnw test', './mvnw -B test', '.\\mvnw test', 'mvnw.cmd test', 'mvn -q test', 'cd backend && mvnw test']) {
        assert.ok(isTestCommand(c), c);
    }
    assert.ok(!isTestCommand('mvnw package'));
});

test('checks: missing ESLint / ESLint config / test script are warnings, not code errors', async () => {
    const linter = await runLinter(process.cwd());
    assert.equal(typeof linter.ok, 'boolean');

    const tester = await runTests(process.cwd());
    assert.equal(typeof tester.ok, 'boolean');
});
