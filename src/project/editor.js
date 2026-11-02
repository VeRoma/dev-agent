import { exec } from 'child_process';

/** Открывает файл в VS Code. Отключается переменной DEV_AGENT_NO_EDITOR (тесты). */
export function openInEditor(absolutePath) {
    if (process.env.DEV_AGENT_NO_EDITOR) return;
    // Путь попадает в shell-строку: файлы со спецсимволами не открываем
    if (/["'`$&|;<>%^\r\n]/.test(absolutePath)) return;
    exec(`code "${absolutePath}"`, () => {});
}
