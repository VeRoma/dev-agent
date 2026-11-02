import { ask } from '../llm/index.js';
import { translateToRussianIfEnglish } from '../llm/translate.js';
import { parseModelJsonObject as parseModelJson } from '@veroma/ai-core/json';

async function askJson(prompt, tier, label) {
    // json: 'object' — ai-core validates the reply and moves to the next fallback model on garbage
    return parseModelJson(await ask(prompt, { tier, json: 'object', label }));
}

/**
 * JSON from the executor of the given tier; if every model replied with garbage — ONE retry with a hint.
 * @param {string} [label] call role for the usage report (default: the tier)
 */
export async function askForJson(prompt, tier = 'fast', label = tier) {
    try {
        return await askJson(prompt, tier, label);
    } catch (firstError) {
        console.log(`⚠️ Модель вернула невалидный JSON (${firstError.message}). Повторный запрос...`);
        const retryPrompt = `${prompt}\n\nYour previous reply was NOT valid JSON (${firstError.message}). Reply again with ONLY one valid raw JSON object: no markdown, no commentary, all strings properly escaped, and make sure the reply is not truncated.`;
        return askJson(retryPrompt, tier, `${label} json-retry`);
    }
}

/** Agent reply: parsed JSON, the message translated to Russian when needed. */
export async function askAgent(prompt, tier = 'fast', label = tier) {
    const parsed = await askForJson(prompt, tier, label);
    if (typeof parsed.message === 'string') parsed.message = await translateToRussianIfEnglish(parsed.message);
    return parsed;
}
