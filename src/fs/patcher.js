import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export async function applyPatches(targetProject, filesToUpdate) {
    const backupDir = path.join(process.cwd(), '.agent_backup');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    for (const file of filesToUpdate) {
        const absolutePath = path.resolve(process.cwd(), targetProject, file.path);
        const safeRelativePath = file.path.replace(/[\/\\]/g, '__');

        if (fs.existsSync(absolutePath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `${safeRelativePath}_${timestamp}.bak`);
            
            fs.copyFileSync(absolutePath, backupPath);
            console.log(`💾 Backup saved: .agent_backup/${path.basename(backupPath)}`);
        } else {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        }

        fs.writeFileSync(absolutePath, file.content, 'utf-8');
        console.log(`✅ File updated: ${file.path}`);

        try { exec(`code "${absolutePath}"`); } catch (error) {}
    }
}

export async function abortSessionPatches(targetProject) {
    const backupDir = path.join(process.cwd(), '.agent_backup');
    if (!fs.existsSync(backupDir)) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    if (backups.length === 0) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    // --- ЛОГИКА REDO: Сохраняем "грязный" слепок перед откатом ---
    const redoDir = path.join(backupDir, 'redo');
    if (fs.existsSync(redoDir)) fs.rmSync(redoDir, { recursive: true, force: true });
    fs.mkdirSync(redoDir, { recursive: true });

    // Прячем память ИИ
    const sessionPath = path.join(process.cwd(), '.agent_session.tmp');
    if (fs.existsSync(sessionPath)) {
        fs.copyFileSync(sessionPath, path.join(redoDir, 'session.bak'));
    }

    const fileGroups = {};
    for (const backup of backups) {
        const match = backup.match(/^(.*)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.bak$/);
        if (!match) continue;
        
        const safeRelativePath = match[1];
        if (!fileGroups[safeRelativePath]) fileGroups[safeRelativePath] = [];
        fileGroups[safeRelativePath].push(backup);
    }

    for (const [safeRelativePath, backupFiles] of Object.entries(fileGroups)) {
        backupFiles.sort(); 
        const oldestBackup = backupFiles[0];

        const relativePath = safeRelativePath.replace(/__/g, '/');
        const absolutePath = path.resolve(process.cwd(), targetProject, relativePath);
        const oldestBackupPath = path.join(backupDir, oldestBackup);

        // Прячем измененный файл
        if (fs.existsSync(absolutePath)) {
            fs.copyFileSync(absolutePath, path.join(redoDir, `${safeRelativePath}.redo`));
        }

        fs.copyFileSync(oldestBackupPath, absolutePath);
        console.log(`⏪ Restored original file: ${relativePath}`);
        
        try { exec(`code "${absolutePath}"`); } catch (e) {}
    }

    console.log('💡 Tip: You can type /redo to cancel this abort and get your changes back.');
}

export async function applyRedoPatches(targetProject) {
    const redoDir = path.join(process.cwd(), '.agent_backup', 'redo');
    if (!fs.existsSync(redoDir)) {
        console.log('⚠️ Nothing to redo.');
        return false; // <-- Возвращаем false
    }

    const files = fs.readdirSync(redoDir);
    if (files.length === 0) {
        console.log('⚠️ Nothing to redo.');
        return false; // <-- Возвращаем false
    }

    for (const file of files) {
        // Восстанавливаем память ИИ
        if (file === 'session.bak') {
            fs.copyFileSync(path.join(redoDir, file), path.join(process.cwd(), '.agent_session.tmp'));
            continue;
        }

        // Восстанавливаем файлы кода
        if (file.endsWith('.redo')) {
            const safeRelativePath = file.replace('.redo', '');
            const relativePath = safeRelativePath.replace(/__/g, '/');
            const absolutePath = path.resolve(process.cwd(), targetProject, relativePath);

            fs.copyFileSync(path.join(redoDir, file), absolutePath);
            console.log(`⏩ Redo applied: ${relativePath}`);
            try { exec(`code "${absolutePath}"`); } catch (e) {}
        }
    }

    // Зачищаем тайник, чтобы нельзя было применить redo дважды
    fs.rmSync(redoDir, { recursive: true, force: true });
    return true; // <-- Возвращаем true при успехе
}

export function clearSessionBackups() {
    const backupDir = path.join(process.cwd(), '.agent_backup');
    if (!fs.existsSync(backupDir)) return;
    
    const archiveDir = path.join(backupDir, 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    for (const backup of backups) {
        fs.renameSync(path.join(backupDir, backup), path.join(archiveDir, backup));
    }
}