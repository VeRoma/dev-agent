import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Корень агента вычисляется от расположения файла, а не от process.cwd():
// агент работает одинаково, откуда бы его ни запустили (терминал, Telegram-бот).
export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Секреты — из .env в корне агента. Уже заданные переменные окружения не перезаписываются.
try {
    process.loadEnvFile(path.join(AGENT_ROOT, '.env'));
} catch {
    // .env может отсутствовать (ключи тогда берутся из окружения)
}

const CONFIG_PATH = path.join(AGENT_ROOT, 'agent.config.json');

function loadConfig() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (error) {
        throw new Error(`Не удалось прочитать ${CONFIG_PATH}: ${error.message}`);
    }
    parsed.llm ??= {};
    parsed.workspace ??= {};
    parsed.prompts ??= {};
    return parsed;
}

// Единственный экземпляр конфига на весь процесс.
export const config = loadConfig();

/** Выбранный проект живёт только в памяти процесса: файл конфига больше не перезаписывается. */
export function setTargetProject(targetProject) {
    config.workspace.targetProject = targetProject;
}
