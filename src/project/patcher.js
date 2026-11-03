import fs from 'fs';
import path from 'path';
import { getStatePaths } from './state-paths.js';
import { resolveProjectFile, validateFileUpdate } from '@veroma/ai-core/safety';
import { newBackupPath, readCreated, writeCreated, hasBackup } from './backups.js';
import { openInEditor } from './editor.js';
import { buildProjectMap } from './project-map.js';
import { resolveFileContent } from './edits.js';

/**
 * Applies a patch all-or-nothing: every file is validated first, and only if all are clean
 * anything is written to disk. A file comes as full "content" or as search/replace "edits"
 * (resolved to the full content before the guards run).
 * @returns {Promise<{applied: string[], rejected: {path: string, reason: string}[]}>}
 */
export async function applyPatches(targetProject, filesToUpdate = [], filesToDelete = []) {
    const { backupDir, targetAbsolute } = getStatePaths(targetProject);
    fs.mkdirSync(backupDir, { recursive: true });

    // 0. Validation (nothing is written until everything is checked)
    const rejected = [];
    const updates = [];
    const deletions = [];

    for (const file of filesToUpdate) {
        try {
            const { absolutePath, relativePath } = resolveProjectFile(targetAbsolute, file?.path);
            const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null;
            const content = resolveFileContent(file, previous);
            const check = validateFileUpdate(relativePath, previous, content);
            if (!check.ok) throw new Error(check.reason);
            updates.push({ absolutePath, relativePath, content, existed: previous !== null });
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

    // 1. Updates and creations
    for (const file of updates) {
        if (file.existed) {
            const backupPath = newBackupPath(backupDir, file.relativePath);
            fs.copyFileSync(file.absolutePath, backupPath);
            console.log(`💾 Backup saved: .dev-agent/backups/${path.basename(backupPath)}`);
        } else {
            fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
            // A file deleted earlier in this session has a backup: it must be restored, not deleted, on /abort
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

    // 2. Deletions (always backed up first)
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

    // 3. Refresh the project map
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
