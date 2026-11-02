import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { AGENT_ROOT } from '../config.js';

// Self-improvement mode: the agent never edits the copy it is running from.
// It edits a git worktree of its own repository (sibling folder, branch "self-improve");
// a new version reaches the running copy only when the developer merges the branch.

export const SELF_PROJECT = 'self';
export const SELF_BRANCH = 'self-improve';

function git(args, cwd) {
    // No shell: arguments are passed as an array
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** <agent>/../<agent folder>-self */
export function selfWorktreePath(agentRoot = AGENT_ROOT) {
    return path.resolve(agentRoot, '..', `${path.basename(agentRoot)}-self`);
}

/** True if the target project (relative to the agent root or absolute) is the self-improvement worktree. */
export function isSelfWorktree(targetProject, agentRoot = AGENT_ROOT) {
    return path.resolve(agentRoot, targetProject).toLowerCase() === selfWorktreePath(agentRoot).toLowerCase();
}

/** Refuses a target that is the running agent itself: it must only ever edit the worktree. */
export function assertNotAgentRoot(targetAbsolute, agentRoot = AGENT_ROOT) {
    const norm = (p) => path.resolve(p).toLowerCase(); // Windows paths are case-insensitive
    if (norm(targetAbsolute) === norm(agentRoot)) {
        throw new Error('Агент не может править копию, из которой запущен. Для самоулучшения используйте проект "self" (worktree).');
    }
}

/**
 * Creates (or verifies and reuses) the self-improvement worktree.
 * - an existing folder must be a worktree of THIS repository on SELF_BRANCH, otherwise nothing is touched
 * - a clean worktree without its own commits is fast-forwarded to the running branch (stays up to date)
 * - node_modules is linked (junction) from the running copy, so tests run without npm install
 * @returns {{path: string, branch: string, created: boolean, updated: boolean, ahead: number}}
 */
export function ensureSelfWorkspace(agentRoot = AGENT_ROOT) {
    const worktree = selfWorktreePath(agentRoot);
    const mainBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], agentRoot);
    let created = false;

    if (!fs.existsSync(worktree)) {
        const branchExists = git(['branch', '--list', SELF_BRANCH], agentRoot) !== '';
        git(['worktree', 'add', worktree, ...(branchExists ? [SELF_BRANCH] : ['-b', SELF_BRANCH])], agentRoot);
        created = true;
    } else {
        let commonDir, branch;
        try {
            commonDir = path.resolve(worktree, git(['rev-parse', '--git-common-dir'], worktree));
            branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
        } catch {
            throw new Error(`${worktree} существует, но это не git worktree агента. Удалите или переименуйте папку.`);
        }
        const ownCommonDir = path.resolve(agentRoot, git(['rev-parse', '--git-common-dir'], agentRoot));
        if (commonDir.toLowerCase() !== ownCommonDir.toLowerCase() || branch !== SELF_BRANCH) {
            throw new Error(`${worktree} — не worktree этого агента на ветке ${SELF_BRANCH} (сейчас: ${branch}). Ничего не трогаю.`);
        }
    }

    // Up to date with the running branch while there is no unmerged self-work
    let updated = false;
    const clean = git(['status', '--porcelain'], worktree) === '';
    const ahead = Number(git(['rev-list', '--count', `${mainBranch}..${SELF_BRANCH}`], worktree));
    const behind = Number(git(['rev-list', '--count', `${SELF_BRANCH}..${mainBranch}`], worktree));
    if (clean && ahead === 0 && behind > 0) {
        git(['merge', '--ff-only', mainBranch], worktree);
        updated = true;
    }

    const ownModules = path.join(agentRoot, 'node_modules');
    const linkedModules = path.join(worktree, 'node_modules');
    if (fs.existsSync(ownModules) && !fs.existsSync(linkedModules)) {
        fs.symlinkSync(ownModules, linkedModules, 'junction');
    }

    return { path: worktree, branch: SELF_BRANCH, created, updated, ahead };
}
