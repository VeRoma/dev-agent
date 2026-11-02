import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getStatePaths } from './state-paths.js';
import { resolveInside } from '@veroma/ai-core/safety';
import {
    BACKUP_NAME_RE, encodeBackupName, decodeBackupName,
    readCreated, writeCreated, moveBackupsTo,
} from './backups.js';
import { openInEditor } from './editor.js';

/** /abort: возвращает файлы к состоянию до сессии, оставляя снимок для /redo. */
export async function abortSessionPatches(targetProject = config.workspace.targetProject) {
    const { backupDir, redoDir, sessionFile, targetAbsolute } = getStatePaths(targetProject);

    if (!fs.existsSync(backupDir)) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    const created = readCreated(backupDir);
    if (backups.length === 0 && created.length === 0) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    if (fs.existsSync(redoDir)) fs.rmSync(redoDir, { recursive: true, force: true });
    fs.mkdirSync(redoDir, { recursive: true });

    // Память ИИ тоже уходит в снимок для /redo
    if (fs.existsSync(sessionFile)) {
        fs.copyFileSync(sessionFile, path.join(redoDir, 'session.bak'));
    }

    // 1. Файлы, созданные в этой сессии: удаляем (копию оставляем для redo)
    const createdSet = new Set(created);
    for (const relativePath of created) {
        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }
        if (!fs.existsSync(absolutePath)) continue;

        fs.copyFileSync(absolutePath, path.join(redoDir, `${encodeBackupName(relativePath)}.redo`));
        fs.unlinkSync(absolutePath);
        console.log(`🗑️ Removed file created in this session: ${relativePath}`);
    }

    // 2. Изменённые и удалённые файлы: восстанавливаем самую старую версию
    const groups = {};
    for (const backup of backups) {
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
        }

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.copyFileSync(path.join(backupDir, files[0]), absolutePath);
        console.log(`⏪ Restored original file: ${relativePath}`);
        openInEditor(absolutePath);
    }

    // 3. Бэкапы этой сессии уезжают в redo/state: иначе следующий /abort откатил бы
    //    файлы к состоянию до уже отменённой задачи
    const stateDir = path.join(redoDir, 'state');
    moveBackupsTo(stateDir, backupDir);
    writeCreated(stateDir, created);
    writeCreated(backupDir, []);

    console.log('💡 Tip: You can type /redo to cancel this abort and get your changes back.');
}

/** /redo: отменяет /abort. */
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

    // Бэкапы возвращаются на место, чтобы после /redo снова можно было сделать /abort
    const stateDir = path.join(redoDir, 'state');
    if (fs.existsSync(stateDir)) {
        for (const f of fs.readdirSync(stateDir).filter(n => n.endsWith('.bak'))) {
            fs.renameSync(path.join(stateDir, f), path.join(backupDir, f));
        }
        const createdFile = path.join(stateDir, 'created.json');
        if (fs.existsSync(createdFile)) fs.copyFileSync(createdFile, path.join(backupDir, 'created.json'));
    }

    fs.rmSync(redoDir, { recursive: true, force: true });
    return true;
}

/** /save: бэкапы завершённой сессии уходят в архив. */
export function clearSessionBackups(targetProject = config.workspace.targetProject) {
    const { backupDir, archiveDir } = getStatePaths(targetProject);
    if (!fs.existsSync(backupDir)) return;
    moveBackupsTo(archiveDir, backupDir);
    writeCreated(backupDir, []);
}
