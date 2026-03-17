import { exec } from 'child_process';
import path from 'path';

/**
 * Запускает ESLint только для измененных файлов проекта.
 */
export function runLinter(targetProject, filesToUpdate) {
    return new Promise((resolve) => {
        // Отбираем только JS/TS файлы
        const jsFiles = filesToUpdate
            .filter(f => /\.(js|jsx|ts|tsx)$/.test(f.path))
            .map(f => `"${f.path}"`);

        // Если нет файлов для проверки (например, менялся JSON) - всё ок
        if (jsFiles.length === 0) {
            return resolve({ success: true });
        }

        const command = `npx eslint ${jsFiles.join(' ')}`;
        const cwd = path.resolve(process.cwd(), targetProject);

        // Запускаем линтер в папке целевого проекта
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (!error) {
                // Код возврата 0 -> ошибок нет
                resolve({ success: true });
            } else {
                // Код возврата 1 -> есть ошибки
                let errorMessage = stdout || stderr || error.message;
                
                // Защита от переполнения токенов: обрезаем слишком длинные логи
                if (errorMessage.length > 2000) {
                    errorMessage = errorMessage.substring(0, 2000) + '\n... [TRUNCATED]';
                }
                resolve({ success: false, error: errorMessage });
            }
        });
    });
}