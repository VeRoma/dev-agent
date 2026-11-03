import fs from 'fs';
import path from 'path';

// v2 backup names: encodeURIComponent, so paths like "__tests__/a.js" restore unambiguously.
// The old format ("src__core__llm.js") is still read as legacy.
const BACKUP_PREFIX = 'v2~';
export const BACKUP_NAME_RE = /^(.*)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.bak$/;

export function encodeBackupName(relativePath) {
    return BACKUP_PREFIX + encodeURIComponent(relativePath.replace(/\\/g, '/'));
}

export function decodeBackupName(name) {
    if (name.startsWith(BACKUP_PREFIX)) return decodeURIComponent(name.slice(BACKUP_PREFIX.length));
    return name.replace(/__/g, '/'); // legacy
}

export function newBackupPath(backupDir, relativePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(backupDir, `${encodeBackupName(relativePath)}_${timestamp}.bak`);
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

function writeJson(dir, name, value) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf-8');
}

// Files created during the session: a rollback deletes them instead of restoring
export const readCreated = (dir) => readJson(path.join(dir, 'created.json'), []);
export const writeCreated = (dir, list) => writeJson(dir, 'created.json', list);

/**
 * Task journal (tasks.json): which backups and created files belong to which agent task, for /undo.
 * Entry: { label, backups: [backup file names], created: [relative paths] }.
 */
export const readTasks = (dir) => readJson(path.join(dir, 'tasks.json'), []);
export const writeTasks = (dir, list) => writeJson(dir, 'tasks.json', list);

// Label of the task now running; its journal entry is opened lazily, on its first write
let pendingTask = null;

/** Marks the start of a developer task: everything written until the next call is one /undo step. */
export function beginTask(label) {
    pendingTask = String(label ?? '').slice(0, 120);
}

/**
 * Journal entry of the current task, created on first use.
 * Writes outside a started task (tests, direct calls) form one implicit entry.
 */
export function currentTaskEntry(tasks) {
    if (pendingTask !== null || tasks.length === 0) {
        tasks.push({ label: pendingTask ?? '(task)', backups: [], created: [] });
        pendingTask = null;
    }
    return tasks.at(-1);
}

export function hasBackup(backupDir, relativePath) {
    const prefix = encodeBackupName(relativePath) + '_';
    return fs.readdirSync(backupDir).some(f => f.startsWith(prefix) && f.endsWith('.bak'));
}

export function moveBackupsTo(targetDir, backupDir, names = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    const all = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    for (const backup of names ? all.filter(f => names.includes(f)) : all) {
        fs.renameSync(path.join(backupDir, backup), path.join(targetDir, backup));
    }
}
