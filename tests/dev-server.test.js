import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDevServer, stopDevServer, isNodeCrashOutput, isJavaStartupFailure } from '../src/engine/dev-server.js';
import { handleCrash } from '../src/engine/server-supervisor.js';
import { setConfirmHandler, setExclusiveRunner } from '../src/engine/io.js';

function makeProject(appCode) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-server-'));
    fs.writeFileSync(path.join(dir, 'app.js'), appCode);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: { dev: 'node app.js' } }));
    return dir;
}

/** Запускает «dev-сервер» и собирает сообщения о падениях за timeoutMs. */
function runAndCollect(dir, { timeoutMs, stopAfterMs = null }) {
    return new Promise((resolve) => {
        const crashes = [];
        runDevServer(dir, (log) => crashes.push(log));
        if (stopAfterMs) setTimeout(() => stopDevServer(), stopAfterMs);
        setTimeout(() => resolve(crashes), timeoutMs);
    });
}

test('dev-server: words like "error" / "0 failed" in normal output do NOT trigger auto-fix', async () => {
    const dir = makeProject(`console.log('errorHandler ready; 0 failed; Exception filter on'); console.error('error: just a log line');`);
    assert.deepEqual(await runAndCollect(dir, { timeoutMs: 5000 }), []);
});

test('dev-server: a non-zero exit IS a crash, and the model gets the output tail', async () => {
    const dir = makeProject(`console.log('booting'); throw new Error('boom in app.js');`);
    const crashes = await runAndCollect(dir, { timeoutMs: 6000 });
    assert.equal(crashes.length, 1);
    assert.match(crashes[0], /boom in app\.js/);
});

test('dev-server: stopping via /stop is not a crash', async () => {
    const dir = makeProject(`setInterval(() => {}, 1000);`);
    assert.deepEqual(await runAndCollect(dir, { timeoutMs: 5000, stopAfterMs: 2000 }), []);
});

test('dev-server: crash markers for nodemon and Spring Boot', () => {
    assert.ok(isNodeCrashOutput('[nodemon] app crashed - waiting for file changes before starting...'));
    assert.ok(!isNodeCrashOutput('error: request failed, retrying'));
    assert.ok(isJavaStartupFailure('***************************\nAPPLICATION FAILED TO START\n***************************'));
    assert.ok(isJavaStartupFailure('[INFO] BUILD FAILURE'));
    assert.ok(!isJavaStartupFailure('ERROR 1234 --- [nio-8080-exec-1] o.a.c.c.C.[.[.[/] : Servlet.service() threw exception'),
        'a handled request error is not a startup failure');
});

test('supervisor: the developer is asked first; "no" means the agent is not called', async () => {
    const tasks = [];
    const runTask = async (prompt) => { tasks.push(prompt); };

    setConfirmHandler(async () => false);
    await handleCrash('TypeError: boom', runTask);
    assert.equal(tasks.length, 0);

    setConfirmHandler(async () => true);
    await handleCrash('TypeError: boom', runTask);
    assert.equal(tasks.length, 1);
    assert.match(tasks[0], /TypeError: boom/);
});

test('supervisor: while the agent is busy, auto-fix is skipped (never two tasks at once)', async () => {
    const tasks = [];
    setConfirmHandler(async () => true);
    setExclusiveRunner(async () => false);
    try {
        await handleCrash('boom', async (p) => { tasks.push(p); });
    } finally {
        setExclusiveRunner(async (task) => { await task(); return true; });
        setConfirmHandler(async () => false);
    }
    assert.equal(tasks.length, 0);
});
