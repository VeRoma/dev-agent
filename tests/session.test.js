import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setTargetProject } from '../src/config.js';
import { initSession, getSession, appendToSession, splitSession, compressSessionIfNeeded } from '../src/engine/session.js';

const turn = (i, size) => `\n🧑 **Разработчик:** шаг ${i}\n\n🤖 **Агент:** ${'x'.repeat(size)}\n`;

test('session: the split happens at a developer turn and keeps the recent part', () => {
    const content = '# head\n' + [1, 2, 3, 4].map(i => turn(i, 100)).join('');
    const { older, recent } = splitSession(content, 150);
    assert.equal(older + recent, content);
    assert.ok(recent.startsWith('\n🧑 **Разработчик:** шаг'), 'recent part starts at a turn boundary');
    assert.ok(recent.length >= 150);
    assert.deepEqual(splitSession('short', 100), { older: '', recent: 'short' });
});

test('session: compression summarizes only the older part, the recent steps stay verbatim', async () => {
    setTargetProject(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-session-')));
    initSession('t');
    appendToSession('user', 'ПЛАН: шаги 0–14');
    for (let i = 1; i <= 40; i++) appendToSession('user', `шаг ${i}\n\n🤖 **Агент:** ${'y'.repeat(5000)}`);
    appendToSession('user', 'ПОСЛЕДНИЙ ШАГ 41');

    let prompt = '';
    await compressSessionIfNeeded({ ask: async (p) => { prompt = p; return 'РЕЗЮМЕ: план из 15 шагов, сделаны 0–3'; } });

    const session = getSession();
    assert.ok(prompt.includes('ПЛАН: шаги 0–14'), 'the old part (with the plan) goes to the summarizer');
    assert.ok(!prompt.includes('ПОСЛЕДНИЙ ШАГ 41'), 'the recent part is not summarized');
    assert.ok(session.includes('РЕЗЮМЕ: план из 15 шагов'));
    assert.ok(session.includes('ПОСЛЕДНИЙ ШАГ 41'), 'the recent part is kept verbatim');
    assert.ok(session.length < 70000);

    // A failing summarizer leaves the session untouched
    appendToSession('agent', 'z'.repeat(160000));
    const before = getSession();
    await compressSessionIfNeeded({ ask: async () => { throw new Error('down'); } });
    assert.equal(getSession(), before);
});
