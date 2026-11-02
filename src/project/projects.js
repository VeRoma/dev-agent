import fs from 'fs';
import path from 'path';
import { AGENT_ROOT } from '../config.js';
import { SELF_PROJECT } from './self-workspace.js';

// Folder with the projects the agent works on
export const PROJECTS_DIR = path.resolve(AGENT_ROOT, '..', 'repositories');

/** Sorted project names (stable order, the same for the agent and the bot). "self" is reserved. */
export function listProjects(baseDir = PROJECTS_DIR) {
    const agentFolder = path.basename(AGENT_ROOT);
    return fs.readdirSync(baseDir)
        .filter((name) => {
            if (name.startsWith('.') || name === agentFolder || name.toLowerCase() === SELF_PROJECT) return false;
            try {
                return fs.statSync(path.join(baseDir, name)).isDirectory();
            } catch {
                return false;
            }
        })
        .sort((a, b) => a.localeCompare(b));
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
