import { askModel } from '../llm/index.js';
import { translateToRussianIfEnglish } from '../llm/translate.js';
import { parseModelJson } from '../safety/json-utils.js';

/** Запрашивает у исполнителя JSON; при невалидном ответе делает ОДНУ повторную попытку. */
export async function askForJson(prompt) {
    const raw = await askModel(prompt, false);
    try {
        return parseModelJson(raw);
    } catch (firstError) {
        console.log(`⚠️ Модель вернула невалидный JSON (${firstError.message}). Повторный запрос...`);
        const retryPrompt = `${prompt}\n\nYour previous reply was NOT valid JSON (${firstError.message}). Reply again with ONLY one valid raw JSON object: no markdown, no commentary, all strings properly escaped, and make sure the reply is not truncated.`;
        return parseModelJson(await askModel(retryPrompt, false));
    }
}

/** Ответ агента: разобранный JSON, сообщение при необходимости переведено на русский. */
export async function askAgent(prompt) {
    const parsed = await askForJson(prompt);
    if (parsed.message) parsed.message = await translateToRussianIfEnglish(parsed.message);
    return parsed;
}
