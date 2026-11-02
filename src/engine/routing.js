import { config } from '../config.js';
import { askModel } from '../llm/index.js';
import { translateToEnglish } from '../llm/translate.js';
import { ensureProjectMap } from '../project/project-map.js';
import { getSession } from './session.js';

// Достаём массив даже если модель добавила лишний текст или markdown
function parseFileList(raw) {
    const cleaned = String(raw).replace(/```json/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\[.*\]/s);
    const parsed = JSON.parse(match ? match[0] : cleaned);
    return Array.isArray(parsed) ? parsed : [];
}

/** Диспетчер: по карте проекта выбирает файлы, нужные для задачи. Лишних путей не пропускает. */
export async function determineRelevantFiles(userQuery, targetProject = config.workspace.targetProject) {
    console.log('⚡ Диспетчер анализирует карту проекта...');

    const map = ensureProjectMap(targetProject);
    if (!map || map.files.size === 0) return [];

    const translatedQuery = await translateToEnglish(userQuery);

    const prompt = `
You are a smart file router for a codebase.
Based on the USER PROMPT and the CURRENT CHAT SESSION, identify which files from the PROJECT MAP need to be analyzed or modified.

PROJECT MAP:
${map.text}

CURRENT CHAT SESSION (Context for the request):
${getSession() || 'No previous context.'}

USER PROMPT:
${translatedQuery}

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON array of strings representing the exact file paths.
2. Only select files that are explicitly listed in the PROJECT MAP.
3. Do not use markdown wrappers like \`\`\`json or add any conversational text.
4. If no files are needed or relevant, return an empty array [].
`;

    try {
        const response = await askModel(prompt, true);
        return parseFileList(response)
            .filter(f => typeof f === 'string')
            .map(f => f.replace(/\\/g, '/'))
            .filter(f => map.files.has(f));
    } catch (error) {
        console.error('❌ Ошибка диспетчера (сбой парсинга JSON или таймаут):', error.message);
        return []; // лучше пустой выбор, чем переполненный контекст исполнителя
    }
}
