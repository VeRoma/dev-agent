import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getStatePaths } from './state-paths.js';
import { resolveInside } from '@veroma/ai-core/safety';
import {
    BACKUP_NAME_RE, encodeBackupName, decodeBackupName,
    readCreated, writeCreated, readTasks, writeTasks, moveBackupsTo,
} from './backups.js';
import { openInEditor } from './editor.js';

/**
 * Reverts files to their state before the given backups/creations and keeps a /redo snapshot:
 * created files are deleted, every other file gets its OLDEST backup from `backupNames`.
 * The current versions go to redoDir as *.redo; the used backups move to redoDir/state.
 */
function revertFiles({ targetAbsolute, backupDir, redoDir, backupNames, createdPaths }) {
    // 1. Files created in this span: delete (a copy stays for /redo)
    const createdSet = new Set(createdPaths);
    for (const relativePath of createdPaths) {
        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }
        if (!fs.existsSync(absolutePath)) continue;

        fs.copyFileSync(absolutePath, path.join(redoDir, `${encodeBackupName(relativePath)}.redo`));
        fs.unlinkSync(absolutePath);
        console.log(`🗑️ Removed file created by the agent: ${relativePath}`);
    }

    // 2. Edited and deleted files: restore the oldest version
    const absentForRedo = [];
    const groups = {};
    for (const backup of backupNames) {
        const match = backup.match(BACKUP_NAME_RE);
        if (!match) continue;
        (groups[match[1]] ??= []).push(backup);
    }

    for (const [encodedName, files] of Object.entries(groups)) {
        const relativePath = decodeBackupName(encodedName);
        if (createdSet.has(relativePath)) continue;

        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }

        files.sort();
        if (fs.existsSync(absolutePath)) {
            fs.copyFileSync(absolutePath, path.join(redoDir, `${encodeBackupName(relativePath)}.redo`));
        } else {
            absentForRedo.push(relativePath); // deleted by the agent: /redo must delete it again
        }

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.copyFileSync(path.join(backupDir, files[0]), absolutePath);
        console.log(`⏪ Restored: ${relativePath}`);
        openInEditor(absolutePath);
    }
    if (absentForRedo.length > 0) {
        fs.writeFileSync(path.join(redoDir, 'deleted.json'), JSON.stringify(absentForRedo, null, 2), 'utf-8');
    }

    // 3. The used backups leave backupDir: otherwise the next rollback would restore
    //    files to a state before an already reverted change
    moveBackupsTo(path.join(redoDir, 'state'), backupDir, backupNames);
}

/** Starts a fresh /redo snapshot; the journals as they were go to redo/state so /redo can put them back. */
function startRedo({ backupDir, redoDir }) {
    if (fs.existsSync(redoDir)) fs.rmSync(redoDir, { recursive: true, force: true });
    const stateDir = path.join(redoDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    writeCreated(stateDir, readCreated(backupDir));
    writeTasks(stateDir, readTasks(backupDir));
}

/** /abort: returns files to their state before the session, keeping a snapshot for /redo. */
export async function abortSessionPatches(targetProject = config.workspace.targetProject) {
    const paths = getStatePaths(targetProject);
    const { backupDir, redoDir, sessionFile } = paths;

    const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.endsWith('.bak')) : [];
    const created = fs.existsSync(backupDir) ? readCreated(backupDir) : [];
    if (backups.length === 0 && created.length === 0) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    startRedo(paths);
    // The AI memory goes into the /redo snapshot too (the interface erases it on /abort)
    if (fs.existsSync(sessionFile)) fs.copyFileSync(sessionFile, path.join(redoDir, 'session.bak'));

    revertFiles({ ...paths, backupNames: backups, createdPaths: created });
    writeCreated(backupDir, []);
    writeTasks(backupDir, []);

    console.log('💡 Tip: You can type /redo to cancel this abort and get your changes back.');
}

/**
 * /undo: reverts only the last agent task that changed files (all its fixing attempts together).
 * The session memory stays. /redo brings the task back.
 * @returns {Promise<string|null>} label of the undone task, null if there is nothing to undo
 */
export async function undoLastTask(targetProject = config.workspace.targetProject) {
    const paths = getStatePaths(targetProject);
    const { backupDir } = paths;
    const tasks = fs.existsSync(backupDir) ? readTasks(backupDir) : [];
    while (tasks.length > 0 && tasks.at(-1).backups.length === 0 && tasks.at(-1).created.length === 0) tasks.pop();
    const task = tasks.pop();
    if (!task) {
        console.log('⚠️ Nothing to undo: the agent has not changed files since the last /save or /abort.');
        return null;
    }

    startRedo(paths);
    revertFiles({ ...paths, backupNames: task.backups, createdPaths: task.created });
    writeCreated(backupDir, readCreated(backupDir).filter(p => !task.created.includes(p)));
    writeTasks(backupDir, tasks);

    console.log('💡 Tip: You can type /redo to bring this task back.');
    return task.label;
}

/** /redo: cancels the last /abort or /undo. */
export async function applyRedoPatches(targetProject = config.workspace.targetProject) {
    const { backupDir, redoDir, sessionFile, targetAbsolute } = getStatePaths(targetProject);

    if (!fs.existsSync(redoDir) || fs.readdirSync(redoDir).length === 0) {
        console.log('⚠️ Nothing to redo.');
        return false;
    }

    for (const file of fs.readdirSync(redoDir)) {
        if (file === 'session.bak') {
            fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
            fs.copyFileSync(path.join(redoDir, file), sessionFile);
            continue;
        }
        if (!file.endsWith('.redo')) continue;

        const relativePath = decodeBackupName(file.slice(0, -'.redo'.length));
        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.copyFileSync(path.join(redoDir, file), absolutePath);
        console.log(`⏩ Redo applied: ${relativePath}`);
        openInEditor(absolutePath);
    }

    // Files the agent had deleted are deleted again
    let deleted = [];
    try { deleted = JSON.parse(fs.readFileSync(path.join(redoDir, 'deleted.json'), 'utf-8')); } catch { /* none */ }
    for (const relativePath of deleted) {
        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            fs.unlinkSync(absolutePath);
            console.log(`⏩ Redo: deleted again ${relativePath}`);
        }
    }

    // Backups and journals go back, so /abort and /undo work again after /redo
    const stateDir = path.join(redoDir, 'state');
    if (fs.existsSync(stateDir)) {
        for (const f of fs.readdirSync(stateDir).filter(n => n.endsWith('.bak'))) {
            fs.renameSync(path.join(stateDir, f), path.join(backupDir, f));
        }
        for (const journal of ['created.json', 'tasks.json']) {
            const file = path.join(stateDir, journal);
            if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupDir, journal));
        }
    }

    fs.rmSync(redoDir, { recursive: true, force: true });
    return true;
}

/** /save: backups of the finished session go to the archive. */
export function clearSessionBackups(targetProject = config.workspace.targetProject) {
    const { backupDir, archiveDir } = getStatePaths(targetProject);
    if (!fs.existsSync(backupDir)) return;
    moveBackupsTo(archiveDir, backupDir);
    writeCreated(backupDir, []);
    writeTasks(backupDir, []);
}
