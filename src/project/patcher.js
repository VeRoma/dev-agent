import fs from 'fs';
import path from 'path';
import { getStatePaths } from './state-paths.js';
import { resolveProjectFile, validateFileUpdate } from '@veroma/ai-core/safety';
import { newBackupPath, readCreated, writeCreated, hasBackup } from './backups.js';
import { openInEditor } from './editor.js';
import { buildProjectMap } from './project-map.js';

/**
 * Применяет патч по принципу «всё или ничего»: сначала валидация всех файлов,
 * и только если всё чисто — запись на диск.
 * @returns {Promise<{applied: string[], rejected: {path: string, reason: string}[]}>}
 */
export async function applyPatches(targetProject, filesToUpdate = [], filesToDelete = []) {
    const { backupDir, targetAbsolute } = getStatePaths(targetProject);
    fs.mkdirSync(backupDir, { recursive: true });

    // 0. Валидация (ничего не пишем, пока не проверили всё)
    const rejected = [];
    const updates = [];
    const deletions = [];

    for (const file of filesToUpdate) {
        try {
            const { absolutePath, relativePath } = resolveProjectFile(targetAbsolute, file?.path);
            const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null;
            const check = validateFileUpdate(relativePath, previous, file?.content);
            if (!check.ok) throw new Error(check.reason);
            updates.push({ absolutePath, relativePath, content: file.content, existed: previous !== null });
        } catch (error) {
            rejected.push({ path: file?.path ?? '(no path)', reason: error.message });
        }
    }

    for (const file of filesToDelete) {
        try {
            deletions.push(resolveProjectFile(targetAbsolute, file?.path));
        } catch (error) {
            rejected.push({ path: file?.path ?? '(no path)', reason: error.message });
        }
    }

    if (rejected.length > 0) {
        console.log('🛡️ Патч отклонён, ничего не записано:');
        rejected.forEach(r => console.log(`   ✖ ${r.path}: ${r.reason}`));
        return { applied: [], rejected };
    }

    const applied = [];
    const created = readCreated(backupDir);

    // 1. Обновления и создания
    for (const file of updates) {
        if (file.existed) {
            const backupPath = newBackupPath(backupDir, file.relativePath);
            fs.copyFileSync(file.absolutePath, backupPath);
            console.log(`💾 Backup saved: .dev-agent/backups/${path.basename(backupPath)}`);
        } else {
            fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
            // Файл, удалённый ранее в этой сессии, имеет бэкап — его надо восстановить, а не удалить
            if (!created.includes(file.relativePath) && !hasBackup(backupDir, file.relativePath)) {
                created.push(file.relativePath);
            }
        }

        fs.writeFileSync(file.absolutePath, file.content, 'utf-8');
        console.log(`✅ File updated: ${file.relativePath}`);
        applied.push(file.relativePath);
        openInEditor(file.absolutePath);
    }
    writeCreated(backupDir, created);

    // 2. Удаления (с обязательным бэкапом)
    for (const file of deletions) {
        if (fs.existsSync(file.absolutePath) && fs.statSync(file.absolutePath).isFile()) {
            const backupPath = newBackupPath(backupDir, file.relativePath);
            fs.copyFileSync(file.absolutePath, backupPath);
            console.log(`💾 Backup saved (before delete): .dev-agent/backups/${path.basename(backupPath)}`);
            fs.unlinkSync(file.absolutePath);
            console.log(`🗑️ File deleted: ${file.relativePath}`);
            applied.push(file.relativePath);
        } else {
            console.log(`⚠️ Skip deletion: File not found ${file.relativePath}`);
        }
    }

    // 3. Обновляем карту проекта
    if (updates.length > 0 || deletions.length > 0) {
        try {
            console.log('[Dev-Agent] 🔄 Обновление карты проекта...');
            buildProjectMap(targetProject);
        } catch (error) {
            console.error('⚠️ Ошибка при обновлении карты проекта:', error.message);
        }
    }

    return { applied, rejected: [] };
}
