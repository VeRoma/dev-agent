import fs from 'fs';
import path from 'path';
import { AGENT_ROOT } from '../config.js';
import { SELF_PROJECT } from './self-workspace.js';

// Folder with the projects the agent works on
export const PROJECTS_DIR = path.resolve(AGENT_ROOT, '..', 'repositories');

// The OS denies access (e.g. a junction into a protected folder): shown in menus, never selectable
const NO_ACCESS_CODES = new Set(['EPERM', 'EACCES']);

/**
 * Project folders, sorted (stable order, the same for the agent and the bot). "self" is reserved.
 * @returns {{projects: string[], inaccessible: string[]}} inaccessible ones are not numbered,
 *   so they never shift the numbers of selectable projects; broken links are skipped silently
 */
export function scanProjects(baseDir = PROJECTS_DIR, { stat = fs.statSync } = {}) {
    const agentFolder = path.basename(AGENT_ROOT);
    const projects = [];
    const inaccessible = [];
    const names = fs.readdirSync(baseDir).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
        if (name.startsWith('.') || name === agentFolder || name.toLowerCase() === SELF_PROJECT) continue;
        try {
            if (stat(path.join(baseDir, name)).isDirectory()) projects.push(name);
        } catch (error) {
            if (NO_ACCESS_CODES.has(error?.code)) inaccessible.push(name);
        }
    }
    return { projects, inaccessible };
}

/** Selectable project names. */
export function listProjects(baseDir = PROJECTS_DIR) {
    return scanProjects(baseDir).projects;
}

/** Menu line for a folder the OS denies access to. */
export function inaccessibleLabel(name) {
    return `⛔ ${name} — нет доступа`;
}

/** Explains a failed selection that names an inaccessible folder; null otherwise. */
export function noAccessMessage(selector, inaccessible) {
    const value = String(selector ?? '').trim();
    return inaccessible.includes(value)
        ? `Нет доступа к папке проекта ${value}: система отказывает в чтении (проверьте права или цель ссылки).`
        : null;
}

/**
 * Finds a project by number (from 1), by exact name, or "self" / 0 — the agent itself (self-improvement worktree).
 * @returns {string|null} project name or null
 */
export function resolveProject(selector, projects = listProjects()) {
    const value = String(selector ?? '').trim();
    if (value === '0' || value.toLowerCase() === SELF_PROJECT) return SELF_PROJECT;
    if (/^\d+$/.test(value)) return projects[Number(value) - 1] ?? null;
    return projects.includes(value) ? value : null;
}

/** Project path relative to the agent root (the format stored in config.workspace). */
export function projectPath(name) {
    return `../repositories/${name}`;
}
