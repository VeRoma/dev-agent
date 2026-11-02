import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveProjectFile } from '@veroma/ai-core/safety';
import { ensureSelfWorkspace, selfWorktreePath, assertNotAgentRoot, isSelfWorktree, selfDiff, SELF_BRANCH } from '../src/project/self-workspace.js';
import { startSupervisedServer } from '../src/engine/server-supervisor.js';

// core.autocrlf may turn LF into CRLF on checkout: compare content, not line endings
const read = (file) => fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf-8' }).trim();

/** A fake agent repository: <tmp>/agent with one commit and node_modules (gitignored). */
function makeAgentRepo() {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-self-')), 'agent');
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.dev-agent/\n');
    fs.writeFileSync(path.join(root, 'agent.js'), 'export const v = 1;\n');
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'v1');
    return root;
}

test('self: the worktree is created next to the agent on its own branch, with linked node_modules', () => {
    const root = makeAgentRepo();
    const ws = ensureSelfWorkspace(root);

    assert.equal(ws.path, selfWorktreePath(root));
    assert.equal(ws.path, path.join(path.dirname(root), 'agent-self'));
    assert.equal(ws.created, true);
    assert.equal(git(ws.path, 'rev-parse', '--abbrev-ref', 'HEAD'), SELF_BRANCH);
    assert.equal(read(path.join(ws.path, 'agent.js')), 'export const v = 1;\n');
    assert.ok(fs.existsSync(path.join(ws.path, 'node_modules', 'dep')), 'tests in the worktree can resolve dependencies');
    assert.equal(git(ws.path, 'status', '--porcelain'), '', 'the node_modules link is ignored by git');

    assert.equal(ensureSelfWorkspace(root).created, false, 'an existing worktree is reused');
});

test('self: a clean worktree follows the running version; one with its own commits is left alone', () => {
    const root = makeAgentRepo();
    const ws = ensureSelfWorkspace(root);

    fs.writeFileSync(path.join(root, 'agent.js'), 'export const v = 2;\n');
    git(root, 'commit', '-q', '-am', 'v2');
    assert.equal(ensureSelfWorkspace(root).updated, true);
    assert.equal(read(path.join(ws.path, 'agent.js')), 'export const v = 2;\n');

    fs.writeFileSync(path.join(ws.path, 'new.js'), 'export const n = 1;\n');
    git(ws.path, 'add', '-A');
    git(ws.path, 'commit', '-q', '-m', 'self work');
    fs.writeFileSync(path.join(root, 'agent.js'), 'export const v = 3;\n');
    git(root, 'commit', '-q', '-am', 'v3');

    const again = ensureSelfWorkspace(root);
    assert.equal(again.updated, false, 'unmerged self-work is never rewritten');
    assert.equal(again.ahead, 1);
    assert.ok(fs.existsSync(path.join(ws.path, 'new.js')));
});

test('self: a foreign folder at the worktree path is refused and left untouched', () => {
    const root = makeAgentRepo();
    const foreign = selfWorktreePath(root);
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'mine.txt'), 'keep');

    assert.throws(() => ensureSelfWorkspace(root), /не git worktree|не worktree/);
    assert.equal(fs.readFileSync(path.join(foreign, 'mine.txt'), 'utf-8'), 'keep');
});

test('self: the running copy is never a target, and patches cannot escape the worktree into it', () => {
    const root = makeAgentRepo();
    const ws = ensureSelfWorkspace(root);

    assert.throws(() => assertNotAgentRoot(root, root), /не может править копию/);
    assert.throws(() => assertNotAgentRoot(root.toUpperCase(), root), undefined, 'case-insensitive on Windows');
    assert.doesNotThrow(() => assertNotAgentRoot(ws.path, root));

    assert.throws(() => resolveProjectFile(ws.path, '../agent/agent.js'), /escapes/);
    assert.ok(isSelfWorktree(ws.path, root));
    assert.ok(!isSelfWorktree(root, root));
});

test('self: the worktree is never started as a dev server (it would run a copy of the agent)', () => {
    let ran = false;
    startSupervisedServer(selfWorktreePath(), async () => { ran = true; });
    assert.equal(ran, false);
});

test('self-diff: commits, uncommitted edits and new files of the agent; later commits on the running branch are not its changes', () => {
    const root = makeAgentRepo();
    assert.equal(selfDiff(root), null, 'no worktree yet');

    const ws = ensureSelfWorkspace(root);
    assert.equal(selfDiff(root).hasChanges, false);

    // the agent: one commit, one uncommitted edit, one new file
    fs.writeFileSync(path.join(ws.path, 'feature.js'), 'export const f = 1;\n');
    git(ws.path, 'add', '-A');
    git(ws.path, 'commit', '-q', '-m', 'add feature');
    fs.writeFileSync(path.join(ws.path, 'agent.js'), 'export const v = 1; // improved\n');
    fs.writeFileSync(path.join(ws.path, 'draft.js'), 'export const d = 1;\n');
    // meanwhile the developer commits to the running branch
    fs.writeFileSync(path.join(root, 'other.js'), 'export const o = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'developer work');

    const report = selfDiff(root);
    assert.equal(report.hasChanges, true);
    assert.deepEqual(report.commits.map(c => c.split(' ').slice(1).join(' ')), ['add feature']);
    assert.equal(report.behind, 1);
    assert.match(report.stat, /feature\.js/);
    assert.match(report.stat, /agent\.js/, 'uncommitted edits are included');
    assert.deepEqual(report.untracked, ['draft.js']);
    assert.ok(!report.stat.includes('other.js') && !report.diff.includes('other.js'), 'the developer\'s commit is not the agent\'s change');
    assert.match(report.diff, /\+export const v = 1; \/\/ improved/);
});
