import fs from 'fs';
import { getStatePaths } from '../project/state-paths.js';
import { askModel } from '../llm/index.js';

const MAX_SESSION_LENGTH = 150000;

// Файл сессии: <проект>/.dev-agent/session.md (markdown, чтобы красиво читался в git)
function sessionFilePath() {
    const { stateDir, sessionFile } = getStatePaths();
    fs.mkdirSync(stateDir, { recursive: true });
    return sessionFile;
}

export function initSession(taskName) {
    const file = sessionFilePath();
    if (fs.existsSync(file)) {
        fs.appendFileSync(file, `\n\n--- 🔄 СЕРВЕР ПЕРЕЗАПУЩЕН: ${taskName} ---\n`, 'utf-8');
        return fs.readFileSync(file, 'utf-8');
    }
    const initialContent = `# Сессия: ${taskName}\n**Статус:** В работе\n\n## 🔄 Журнал попыток и диалог\n`;
    fs.writeFileSync(file, initialContent, 'utf-8');
    return initialContent;
}

export function getSession() {
    const file = sessionFilePath();
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

export function appendToSession(role, text) {
    const file = sessionFilePath();
    if (!fs.existsSync(file)) return;
    const prefix = role === 'user' ? '\n🧑 **Разработчик:** ' : '\n🤖 **Агент:** ';
    fs.appendFileSync(file, `${prefix}${text}\n`, 'utf-8');
}

export function clearSession() {
    const file = sessionFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Когда сессия разрастается, её содержимое сжимается в краткое резюме. */
export async function compressSessionIfNeeded() {
    const file = sessionFilePath();
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, 'utf-8');
    if (content.length <= MAX_SESSION_LENGTH) return;

    console.log('\n🧹 Память переполнена. Запускаю быстрое сжатие контекста...');

    const prompt = `You are an AI assistant summarizing a development session.
Read the following chat history between a Developer and an AI Agent.
Create a highly concise, structured summary in Russian.
Include:
1. The main goal of the current session.
2. What has been successfully implemented so far.
3. The current unresolved problem or the last action taken.

Keep it strictly factual and under 1500 characters. DO NOT write code blocks.

CHAT HISTORY:
${content}
`;

    try {
        const summary = await askModel(prompt, true);
        fs.writeFileSync(file, `# Сжатая сессия\n**Статус:** Контекст был сжат для экономии памяти и защиты от галлюцинаций.\n\n## 📝 Краткое содержание предыдущих действий:\n${summary}\n\n## 🔄 Продолжение диалога:\n`, 'utf-8');
        console.log('✅ Контекст успешно сжат! Продолжаем работу.');
    } catch (error) {
        console.error('⚠️ Ошибка при сжатии контекста:', error.message);
    }
}
