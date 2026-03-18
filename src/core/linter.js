import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Вспомогательная функция для запуска shell-команд через Promise
 */
function runCommand(command, cwd) {
    return new Promise((resolve) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (!error) {
                resolve({ success: true });
            } else {
                let errorMessage = stdout || stderr || error.message || 'Unknown error';
                // Обрезаем слишком длинные логи, чтобы не взорвать контекст ИИ
                if (errorMessage.length > 2000) {
                    errorMessage = errorMessage.substring(0, 2000) + '\n... [TRUNCATED]';
                }
                resolve({ success: false, error: errorMessage });
            }
        });
    });
}

/**
 * Запускает двухэтапную проверку: ESLint -> TypeScript
 */
export async function runLinter(targetProject, filesToUpdate) {
    const jsFiles = filesToUpdate
        .filter(f => /\.(js|jsx|ts|tsx)$/.test(f.path))
        .map(f => `"${f.path}"`);

    // Если JS/TS файлы не менялись, проверка не нужна
    if (jsFiles.length === 0) {
        return { success: true };
    }

    const cwd = path.resolve(process.cwd(), targetProject);

    // --- ЭТАП 1: ESLint (Строгий синтаксис) ---
    const eslintCmd = `npx eslint ${jsFiles.join(' ')} --max-warnings=0`;
    const eslintResult = await runCommand(eslintCmd, cwd);

    if (!eslintResult.success) {
        return { success: false, error: `[ESLint Error]:\n${eslintResult.error}` };
    }

    // --- ЭТАП 2: TypeScript (Строгие типы) ---
    // Проверяем, есть ли в проекте tsconfig.json
    if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
        // --noEmit просто проверяет типы, не создавая .js файлов
        const tscCmd = `npx tsc --noEmit`;
        const tscResult = await runCommand(tscCmd, cwd);

        if (!tscResult.success) {
            return { success: false, error: `[TypeScript Error]:\n${tscResult.error}` };
        }
    }

    // Если обе проверки пройдены
    return { success: true };
}