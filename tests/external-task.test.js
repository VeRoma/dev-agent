import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternalTask } from '../src/cli/external-task.js';

test('external tasks (Telegram): text is a task, report commands run as commands, the rest is refused', () => {
    assert.equal(classifyExternalTask('добавь функцию multiply'), 'task');
    assert.equal(classifyExternalTask('  explain /etc in the docs'), 'task', 'a slash later in the text is still a task');
    for (const cmd of ['/audit', '/audit security only', '/self-diff', '/SELF-DIFF full', '/index']) {
        assert.equal(classifyExternalTask(cmd), 'command', cmd);
    }
    for (const cmd of ['/run', '/editor', '/abort', '/redo', '/save', '/push', '/p 3', '/self', '/unknown']) {
        assert.equal(classifyExternalTask(cmd), 'refused', cmd);
    }
});
