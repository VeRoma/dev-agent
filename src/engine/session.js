import fs from 'fs';
import { getStatePaths } from '../project/state-paths.js';
import { askModel } from '../llm/index.js';

const MAX_SESSION_LENGTH = 150000;
// After compression the most recent part stays verbatim: the current step, its errors and the last decisions
const KEEP_RECENT_LENGTH = 50000;
const TURN_MARK = /\n(?=🧑 \*\*Разработчик:\*\*)/g;

// Session file: <project>/.dev-agent/session.md (markdown, readable in git)
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

/**
 * Splits the session into an older part (to summarize) and the recent part (kept verbatim),
 * at the start of a developer turn so no exchange is cut in half.
 * @returns {{older: string, recent: string}}
 */
export function splitSession(content, keepRecent = KEEP_RECENT_LENGTH) {
    const target = content.length - keepRecent;
    if (target <= 0) return { older: '', recent: content };
    let cut = -1; // the last developer turn that still leaves at least keepRecent verbatim
    for (const match of content.matchAll(TURN_MARK)) {
        if (match.index > target) break;
        cut = match.index;
    }
    if (cut <= 0) cut = target; // one huge turn: cut by length
    return { older: content.slice(0, cut), recent: content.slice(cut) };
}

/**
 * When the session grows too long, its older part is replaced by a summary; the recent part stays as is.
 * The summary is written by the cloud fast tier: the local model's context (8k tokens) would silently
 * cut a 40k-token history.
 */
export async function compressSessionIfNeeded({ ask = askModel } = {}) {
    const file = sessionFilePath();
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, 'utf-8');
    if (content.length <= MAX_SESSION_LENGTH) return;

    console.log('\n🧹 Память переполнена. Сжимаю старую часть сессии, последние шаги остаются дословно...');
    const { older, recent } = splitSession(content);

    const prompt = `You are summarizing the OLDER part of a development session between a Developer and an AI Agent.
The most recent part of the session is kept verbatim after your summary, so focus on what must not be lost.
Write in Russian, strictly factual, no code blocks, at most 5000 characters. Keep:
1. The overall goal and the constraints the developer set.
2. The agreed plan: EVERY step with its number, a one-line description, the planned verification and its status
   (done and committed / done / not started). Do not merge or drop steps.
3. Decisions and answers of the developer (what was approved, rejected, postponed to separate tickets).
4. Facts found in the code that later steps rely on (behaviour quirks to preserve, known bugs not to fix, risks).
5. Files and classes created so far.

OLDER PART OF THE SESSION:
${older}
`;

    try {
        const summary = await ask(prompt);
        fs.writeFileSync(file, `# Сжатая сессия\n**Статус:** старая часть сессии сжата, последние шаги — дословно ниже.\n\n## 📝 Краткое содержание предыдущих действий:\n${String(summary).trim()}\n\n## 🔄 Продолжение диалога (дословно):\n${recent}`, 'utf-8');
        console.log('✅ Контекст сжат. Продолжаем работу.');
    } catch (error) {
        console.error('⚠️ Ошибка при сжатии контекста (сессия оставлена как есть):', error.message);
    }
}
