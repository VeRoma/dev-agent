import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DEV_AGENT_NO_EDITOR = '1'; // do not open VS Code from tests

const { applyPatches } = await import('../src/project/patcher.js');
const { applyEdits } = await import('../src/project/edits.js');
const { abortSessionPatches, applyRedoPatches, undoLastTask } = await import('../src/project/rollback.js');
const { beginTask } = await import('../src/project/backups.js');
const { readFilesContent } = await import('../src/project/file-manager.js');
const { getStatePaths } = await import('../src/project/state-paths.js');

function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-test-'));
    fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', '__tests__', 't.js'), 'export const t = 1;\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('patcher: traversal is rejected and NOTHING is written (all-or-nothing)', async () => {
    const dir = makeProject();
    const outsideName = 'evil-' + path.basename(dir) + '.js';
    const result = await applyPatches(dir, [
        { path: 'src/a.js', content: 'export const a = 2;\n' },
        { path: '../' + outsideName, content: 'export const x = 1;\n' },
    ]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.applied.length, 0);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.ok(!fs.existsSync(path.join(path.dirname(dir), outsideName)));
});

test('edits: in order, exactly one match each, file line endings kept', () => {
    const src = 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n';
    assert.equal(
        applyEdits(src, [{ search: 'const b = 2;', replace: 'const b = 3;' }, { search: 'const b = 3;\n', replace: '' }]),
        'const a = 1;\nconst a2 = 1;\n',
    );
    // Model sends \n, the Windows file has \r\n: matched and written with \r\n
    assert.equal(applyEdits('x();\r\ny();\r\n', [{ search: 'x();\ny();', replace: 'x();\nz();' }]), 'x();\r\nz();\r\n');

    assert.throws(() => applyEdits(src, [{ search: 'nope', replace: '' }]), /edit #1: "search" not found/);
    assert.throws(() => applyEdits(src, [{ search: ' = 1;', replace: '' }]), /matches 2 places/);
    assert.throws(() => applyEdits(src, [{ search: '  ', replace: 'x' }]), /non-empty string/);
    assert.throws(() => applyEdits(src, []), /non-empty array/);
    // A later edit sees the result of the earlier one
    assert.throws(() => applyEdits(src, [{ search: 'const b = 2;', replace: 'B' }, { search: 'const b = 2;', replace: 'C' }]), /edit #2/);
});

test('patcher: search/replace edits patch a big file without resending it; a bad edit rejects the whole patch', async () => {
    const dir = makeProject();
    const big = Array.from({ length: 300 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'src', 'big.js'), big);

    const ok = await applyPatches(dir, [{ path: 'src/big.js', edits: [{ search: 'export const v150 = 150;', replace: 'export const v150 = -150;' }] }]);
    assert.deepEqual(ok.applied, ['src/big.js']);
    assert.equal(read(dir, 'src/big.js'), big.replace('v150 = 150;', 'v150 = -150;'));
    const backups = fs.readdirSync(getStatePaths(dir).backupDir).filter(f => f.endsWith('.bak'));
    assert.equal(backups.length, 1, 'edited file is backed up like a full rewrite');

    // One failing edit in one file: nothing is written in any file
    const bad = await applyPatches(dir, [
        { path: 'src/a.js', content: 'export const a = 2;\n' },
        { path: 'src/big.js', edits: [{ search: 'export const v7 = 999;', replace: 'x' }] },
    ]);
    assert.equal(bad.applied.length, 0);
    assert.match(bad.rejected[0].reason, /not found/);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');

    // Guards still see the full result: edits cannot produce broken JS, a new file needs "content"
    assert.match((await applyPatches(dir, [{ path: 'src/a.js', edits: [{ search: 'const a = 1', replace: 'const = ' }] }])).rejected[0].reason, /syntax/i);
    assert.match((await applyPatches(dir, [{ path: 'src/new.js', edits: [{ search: 'x', replace: 'y' }] }])).rejected[0].reason, /existing file/);
    assert.match((await applyPatches(dir, [{ path: 'src/a.js', content: 'x', edits: [] }])).rejected[0].reason, /not both/);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('patcher: protects .env, .git and agent state; placeholder and broken JS are rejected', async () => {
    const dir = makeProject();
    for (const p of ['.env', '.git/config', '.dev-agent/session.md']) {
        assert.equal((await applyPatches(dir, [{ path: p, content: 'x' }])).rejected.length, 1, p);
    }
    assert.equal((await applyPatches(dir, [], [{ path: '.env' }])).rejected.length, 1);
    assert.ok(fs.existsSync(path.join(dir, '.env')));
    assert.equal((await applyPatches(dir, [{ path: 'src/a.js', content: '// ... (остальной код остается без изменений) ...' }])).rejected.length, 1);
    assert.equal((await applyPatches(dir, [{ path: 'src/a.js', content: 'export const = ;' }])).rejected.length, 1);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('patcher: state lives in ONE place (.dev-agent) and the map is refreshed there', async () => {
    const dir = makeProject();
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 2;\nexport function extra() {}\n' }]);
    const { backupDir, mapFile } = getStatePaths(dir);
    assert.ok(fs.readdirSync(backupDir).some(f => f.startsWith('v2~src%2Fa.js_')));
    assert.ok(fs.readFileSync(mapFile, 'utf-8').includes('extra'));
    assert.ok(!fs.existsSync(path.join(dir, 'PROJECT_MAP.md')), 'map must not pollute the project root');
});

test('rollback: abort restores edited files (incl. "__tests__"), removes created ones; redo and a second abort work', async () => {
    const dir = makeProject();
    await applyPatches(dir, [
        { path: 'src/a.js', content: 'export const a = 2;\n' },
        { path: 'src/__tests__/t.js', content: 'export const t = 2;\n' },
        { path: 'src/new.js', content: 'export const n = 1;\n' },
    ]);
    await applyPatches(dir, [{ path: 'src/new.js', content: 'export const n = 2;\n' }]);

    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.equal(read(dir, 'src/__tests__/t.js'), 'export const t = 1;\n');
    assert.ok(!fs.existsSync(path.join(dir, 'src/new.js')));

    assert.equal(await applyRedoPatches(dir), true);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 2;\n');
    assert.equal(read(dir, 'src/new.js'), 'export const n = 2;\n');

    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.ok(!fs.existsSync(path.join(dir, 'src/new.js')));
});

test('rollback: a file deleted and re-created in one session is restored, not deleted', async () => {
    const dir = makeProject();
    await applyPatches(dir, [], [{ path: 'src/a.js' }]);
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 9;\n' }]);
    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('undo: reverts only the last task (all its attempts), one task at a time; redo and abort still work', async () => {
    const dir = makeProject();
    const exists = (rel) => fs.existsSync(path.join(dir, rel));

    beginTask('task 1');
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 2;\n' }, { path: 'src/new.js', content: 'export const n = 1;\n' }]);
    beginTask('task 2');
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 3;\n' }, { path: 'src/two.js', content: 'export const w = 1;\n' }]);
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 4;\n' }], [{ path: 'src/__tests__/t.js' }]); // a fixing attempt
    beginTask('a chat-only task');                                                    // wrote nothing: not an undo step

    assert.equal(await undoLastTask(dir), 'task 2');
    assert.equal(read(dir, 'src/a.js'), 'export const a = 2;\n', 'back to the state after task 1, not before it');
    assert.ok(!exists('src/two.js'), 'file created by task 2 is removed');
    assert.equal(read(dir, 'src/__tests__/t.js'), 'export const t = 1;\n', 'file deleted by task 2 is back');
    assert.equal(read(dir, 'src/new.js'), 'export const n = 1;\n', 'task 1 is untouched');

    assert.equal(await applyRedoPatches(dir), true);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 4;\n');
    assert.ok(exists('src/two.js') && !exists('src/__tests__/t.js'));

    assert.equal(await undoLastTask(dir), 'task 2', 'after /redo the task can be undone again');
    assert.equal(await undoLastTask(dir), 'task 1');
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.ok(!exists('src/new.js'));
    assert.equal(await undoLastTask(dir), null);

    // /abort after undos: nothing left to revert in this session, files stay original
    beginTask('task 3');
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 5;\n' }]);
    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.equal(await undoLastTask(dir), null, '/abort clears the task journal');
});

test('undo: a file deleted by one task and re-created by the next is deleted, then restored, step by step', async () => {
    const dir = makeProject();
    beginTask('delete');
    await applyPatches(dir, [], [{ path: 'src/a.js' }]);
    beginTask('re-create');
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 9;\n' }]);

    await undoLastTask(dir);
    assert.ok(!fs.existsSync(path.join(dir, 'src/a.js')), 'before "re-create" the file did not exist');
    await undoLastTask(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('rollback: /redo restores the AI session memory from the state dir', async () => {
    const dir = makeProject();
    const { stateDir, sessionFile } = getStatePaths(dir);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(sessionFile, 'MEMORY');
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 2;\n' }]);
    await abortSessionPatches(dir);
    fs.unlinkSync(sessionFile);                       // /abort в интерфейсе стирает память
    await applyRedoPatches(dir);
    assert.equal(fs.readFileSync(sessionFile, 'utf-8'), 'MEMORY');
});

test('file-manager: relative paths resolve against the TARGET, secrets/outsiders skipped, duplicates merged', () => {
    const dir = makeProject();
    const ctx = readFilesContent(['src/a.js', path.join(dir, 'src', 'a.js'), '.env', '../outside.js', 'missing.js'], dir);
    assert.equal((ctx.match(/--- Файл: src\/a\.js ---/g) || []).length, 1);
    assert.ok(ctx.includes('export const a = 1;'));
    assert.ok(!ctx.includes('SECRET'));
});
