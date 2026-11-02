import fs from 'fs';
import path from 'path';
import { AGENT_ROOT } from '../config.js';

// Папка с проектами, над которыми работает агент
export const PROJECTS_DIR = path.resolve(AGENT_ROOT, '..', 'repositories');

/** Отсортированный список имён проектов (порядок стабилен и одинаков для агента и бота). */
export function listProjects(baseDir = PROJECTS_DIR) {
    const agentFolder = path.basename(AGENT_ROOT);
    return fs.readdirSync(baseDir)
        .filter((name) => {
            if (name.startsWith('.') || name === agentFolder) return false;
            try {
                return fs.statSync(path.join(baseDir, name)).isDirectory();
            } catch {
                return false;
            }
        })
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Находит проект по номеру (с 1) или по точному имени.
 * @returns {string|null} имя проекта либо null
 */
export function resolveProject(selector, projects = listProjects()) {
    const value = String(selector ?? '').trim();
    if (/^\d+$/.test(value)) return projects[Number(value) - 1] ?? null;
    return projects.includes(value) ? value : null;
}

/** Путь к проекту относительно корня агента (формат, который хранится в config.workspace). */
export function projectPath(name) {
    return `../repositories/${name}`;
}
