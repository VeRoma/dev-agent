import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DEV_AGENT_NO_EDITOR = '1'; // не открывать VS Code из тестов

const { applyPatches } = await import('../src/project/patcher.js');
const { abortSessionPatches, applyRedoPatches } = await import('../src/project/rollback.js');
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
