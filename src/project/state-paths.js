import path from 'path';
import { AGENT_ROOT, config } from '../config.js';

// Everything the agent keeps about a project (session, backups, map) lives in ONE folder inside it.
export const STATE_DIR_NAME = '.dev-agent';

/**
 * The only place where state paths are computed.
 * No project selected = an error, never a fallback: a default would write into some real project.
 * @param {string} [targetProject] project path (relative to the agent root or absolute)
 */
export function getStatePaths(targetProject = config.workspace.targetProject) {
    if (!targetProject) throw new Error('Проект не выбран: пути состояния агента не определены.');
    const targetAbsolute = path.resolve(AGENT_ROOT, targetProject);
    const stateDir = path.join(targetAbsolute, STATE_DIR_NAME);
    const backupDir = path.join(stateDir, 'backups');
    return {
        targetAbsolute,
        stateDir,
        sessionFile: path.join(stateDir, 'session.md'),
        backupDir,
        redoDir: path.join(backupDir, 'redo'),
        archiveDir: path.join(backupDir, 'archive'),
        mapFile: path.join(stateDir, 'PROJECT_MAP.md'),
    };
}
