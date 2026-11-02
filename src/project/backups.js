import fs from 'fs';
import path from 'path';

// Имена бэкапов формата v2: encodeURIComponent, чтобы пути вроде "__tests__/a.js"
// восстанавливались однозначно. Старый формат ("src__core__llm.js") читается как legacy.
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

// Журнал файлов, созданных в рамках сессии: при откате их нужно удалять, а не восстанавливать
export function readCreated(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'created.json'), 'utf-8'));
    } catch {
        return [];
    }
}

export function writeCreated(dir, list) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'created.json'), JSON.stringify(list, null, 2), 'utf-8');
}

export function hasBackup(backupDir, relativePath) {
    const prefix = encodeBackupName(relativePath) + '_';
    return fs.readdirSync(backupDir).some(f => f.startsWith(prefix) && f.endsWith('.bak'));
}

export function moveBackupsTo(targetDir, backupDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const backup of fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'))) {
        fs.renameSync(path.join(backupDir, backup), path.join(targetDir, backup));
    }
}
