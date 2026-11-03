import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { listProjects, scanProjects, resolveProject, noAccessMessage, inaccessibleLabel } from '../src/project/projects.js';
import { listProjectFiles } from '../src/project/file-manager.js';
import { buildProjectMap, readProjectMap, analyzeFile } from '../src/project/project-map.js';
import { getStatePaths, STATE_DIR_NAME } from '../src/project/state-paths.js';
import { extractMentions, resolveMention, selectContext } from '../src/engine/context-builder.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-proj-'));
const write = (root, rel, content = '') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

test('projects: stable sorted list, hidden dirs and files skipped; select by number OR name', () => {
    const base = tmp();
    for (const d of ['zeta', 'alpha', '.git', 'beta']) fs.mkdirSync(path.join(base, d));
    fs.writeFileSync(path.join(base, 'file.txt'), '');
    const projects = listProjects(base);
    assert.deepEqual(projects, ['alpha', 'beta', 'zeta']);
    assert.equal(resolveProject('2', projects), 'beta');
    assert.equal(resolveProject('zeta', projects), 'zeta');
    for (const bad of ['4', 'nope', '', null]) assert.equal(resolveProject(bad, projects), null, String(bad));
    // 0 / "self" — the agent itself (self-improvement worktree)
    for (const self of ['0', 'self', 'SELF']) assert.equal(resolveProject(self, projects), 'self', self);
});

test('projects: an access-denied folder is listed apart (not numbered, not selectable); a broken link is skipped', () => {
    const base = tmp();
    for (const d of ['alpha', 'locked', 'zeta', 'broken']) fs.mkdirSync(path.join(base, d));
    const deny = { locked: 'EPERM', broken: 'ENOENT' };
    const stat = (p) => {
        const code = deny[path.basename(p)];
        if (code) throw Object.assign(new Error(code), { code });
        return fs.statSync(p);
    };
    const { projects, inaccessible } = scanProjects(base, { stat });
    assert.deepEqual(projects, ['alpha', 'zeta']);
    assert.deepEqual(inaccessible, ['locked']);
    assert.equal(resolveProject('2', projects), 'zeta', 'numbers are not shifted by the locked folder');
    assert.equal(resolveProject('locked', projects), null);
    assert.match(noAccessMessage(' locked ', inaccessible), /Нет доступа.*locked/);
    assert.equal(noAccessMessage('nope', inaccessible), null);
    assert.match(inaccessibleLabel('locked'), /locked — нет доступа/);
});

test('state-paths: everything derives from one state dir inside the project', () => {
    const dir = tmp();
    const p = getStatePaths(dir);
    assert.equal(p.stateDir, path.join(dir, STATE_DIR_NAME));
    for (const key of ['sessionFile', 'backupDir', 'redoDir', 'archiveDir', 'mapFile']) {
        assert.ok(p[key].startsWith(p.stateDir), key);
    }
});

test('file listing: relative POSIX paths; node_modules, state dirs and .env* excluded; dir rules like "dist/" work', () => {
    const root = tmp();
    write(root, 'src/a.js'); write(root, 'src/deep/b.ts');
    write(root, 'node_modules/x/i.js'); write(root, '.dev-agent/session.md'); write(root, '.git/config');
    write(root, '.env', 'S=1'); write(root, 'dist/out.js'); write(root, '.env.example', 'S=');
    const agentRoot = tmp();
    fs.writeFileSync(path.join(agentRoot, '.agentignore'), 'dist/\n*.png\n');
    const files = listProjectFiles(root, { agentRoot });
    assert.deepEqual(files, ['.env.example', 'src/a.js', 'src/deep/b.ts']);
});

test('project map: exports for JS/TS/Java/Python, saved in .dev-agent, secrets never indexed', () => {
    const root = tmp();
    write(root, 'src/a.js', '/** Adds numbers. */\nexport function add(a, b) { return a + b; }\nexport default class Foo {}\n');
    write(root, 'src/b.ts', 'export interface User { id: number }\nexport type Id = number;\nexport { add as sum };\n');
    write(root, 'src/c.js', 'export function run() {}\nexport function stop() {}\n');
    write(root, 'src/D.java', 'public class Dto {}\ninterface Repo {}\n');
    write(root, 'tool.py', 'def go(): pass\nclass Tool: pass\n');
    write(root, '.env', 'KEY=1');

    buildProjectMap(root);
    const map = readProjectMap(root);
    assert.ok(map.files.has('src/a.js') && map.files.has('tool.py'));
    assert.ok(!map.files.has('.env'));
    for (const needle of ['**add** (function): Adds numbers.', '**Foo** (default class)', '**User** (interface)',
        '**Id** (type)', '**sum** (re-export)', '**run** (function)', '**Dto** (class)', '**Repo** (interface)', '**Tool** (class)']) {
        assert.ok(map.text.includes(needle), `missing: ${needle}`);
    }
    assert.ok(fs.existsSync(path.join(root, STATE_DIR_NAME, 'PROJECT_MAP.md')));
    assert.ok(!fs.existsSync(path.join(root, 'PROJECT_MAP.md')));
    assert.deepEqual(analyzeFile('x.txt', 'whatever'), []);
});

test('mentions: e-mails and model tags are not files; trailing punctuation is trimmed; matching by name/tail', () => {
    assert.deepEqual(extractMentions('смотри @src/a.js, и @b.ts. Пиши на me@mail.com, @ds @claude'), ['src/a.js', 'b.ts']);
    const known = ['src/engine/task-runner.js', 'src/llm/index.js', 'agent.js'];
    assert.equal(resolveMention('task-runner', known), 'src/engine/task-runner.js');
    assert.equal(resolveMention('llm/index.js', known), 'src/llm/index.js');
    assert.equal(resolveMention('agent.js', known), 'agent.js');
    assert.equal(resolveMention('ghost.js', known), undefined);
});

test('mentions: files outside the map (.gitignore) can be requested with @, secrets still cannot', async () => {
    const root = tmp();
    write(root, 'src/a.js', 'export const a = 1;\n');
    write(root, '.gitignore', '.env\n');
    write(root, '.env', 'SECRET=1\n');
    // depth > 0: auto-loading continuation, no orchestrator (network) call
    const ctx = await selectContext('[SYSTEM] Дополнительно загружены файлы: @.gitignore @.env', root, { depth: 1 });
    assert.deepEqual(ctx.relevantFiles, ['.gitignore']);
    assert.ok(!ctx.knownFiles.includes('.env'));
    assert.ok(!readProjectMap(root).files.has('.gitignore'), 'precondition: the map does not index .gitignore');
});
