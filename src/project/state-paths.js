import path from 'path';
import { AGENT_ROOT, config } from '../config.js';

// Всё, что агент хранит о проекте (сессия, бэкапы, карта), лежит в ОДНОЙ папке внутри проекта.
export const STATE_DIR_NAME = '.dev-agent';

/**
 * Единственное место, где вычисляются пути состояния.
 * @param {string} [targetProject] путь к проекту (относительно корня агента или абсолютный)
 */
export function getStatePaths(targetProject = config.workspace.targetProject) {
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
