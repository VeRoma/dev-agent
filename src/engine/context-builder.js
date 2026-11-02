import path from 'path';
import { ensureProjectMap } from '../project/project-map.js';
import { orchestrate, translateToEnglish } from '../llm/index.js';

// Tags in the task text that force an executor tier (llm.tiers)
const MODEL_TAGS = {
    ds: 'fast', deepseek: 'fast',
    ge: 'pro', gemini: 'pro',
    cl: 'arch', claude: 'arch',
};
// Look like @mentions but are not files ('7b' is a legacy tag without a tier)
const NOT_FILES = new Set([...Object.keys(MODEL_TAGS), '7b']);

/** @file mentions in the text; e-mails and model tags are ignored. */
export function extractMentions(text) {
    return [...String(text).matchAll(/(?<![\w.])@([a-zA-Z0-9_.\-\/]+)/g)]
        .map(m => m[1].replace(/[.,;:]+$/, ''))
        .filter(m => m && !NOT_FILES.has(m.toLowerCase()));
}

/** The last model tag in the text ("@claude"), or null. "@ds.js" / "@ds/x" are files, "@claude." is a tag. */
export function tierFromTags(text) {
    const tags = [...String(text).matchAll(/(?<![\w.])@([a-zA-Z]+)(?![\w\/-]|\.\w)/g)]
        .map(m => m[1].toLowerCase())
        .filter(tag => tag in MODEL_TAGS);
    return tags.length > 0 ? MODEL_TAGS[tags.at(-1)] : null;
}

/** Finds a file by mention: name, name without extension, or path tail. */
export function resolveMention(mention, knownFiles) {
    return knownFiles.find((file) => {
        const normalized = file.replace(/\\/g, '/');
        const base = path.basename(normalized);
        const nameWithoutExt = base.replace(/\.[^/.]+$/, '');
        return base === mention || nameWithoutExt === mention || normalized === mention || normalized.endsWith(mention);
    });
}

/** Keeps only files from the project map: paths invented by the model are dropped with a warning. */
export function keepKnownFiles(files, knownFiles) {
    const known = new Set(knownFiles);
    const kept = [];
    for (const raw of files) {
        const file = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
        if (known.has(file)) kept.push(file);
        else console.log(`⚠️ Оркестратор предложил файл, которого нет в карте проекта: ${raw} — пропускаю`);
    }
    return kept;
}

/**
 * Task context: project map, files, executor tier and the task wording.
 * depth > 0 (auto-loading files the model asked for): no orchestrator call, the same executor continues.
 * @returns {Promise<{projectMapText: string, knownFiles: string[], relevantFiles: string[],
 *   tier: string, tierForced: boolean, task: string, subtask: string|null}>}
 */
export async function selectContext(text, targetProject, { depth = 0, inheritedFiles = [], tier = null, tierForced = false, forceFullAudit = false } = {}) {
    const map = ensureProjectMap(targetProject);
    const knownFiles = [...map.files];

    const forced = [];
    for (const mention of extractMentions(text)) {
        const matched = resolveMention(mention, knownFiles);
        if (matched) {
            forced.push(matched);
            console.log(`📌 Explicitly included: ${mention}`);
        } else {
            console.log(`⚠️ Mentioned file not found in PROJECT MAP: ${mention}`);
        }
    }

    const tagTier = tierFromTags(text);
    const base = { projectMapText: map.text, knownFiles };

    if (depth > 0) {
        return {
            ...base,
            relevantFiles: [...new Set([...inheritedFiles, ...forced])],
            tier: tagTier ?? tier ?? 'fast',
            tierForced: Boolean(tagTier) || tierForced,
            task: text,
            subtask: null,
        };
    }

    // Only the developer's text needs translation; system messages are already English
    const task = text.startsWith('[SYSTEM') ? text : await translateToEnglish(text);

    console.log('✨ [ORCHESTRATOR] Анализирую задачу и выбираю исполнителя...');
    let decision;
    try {
        decision = await orchestrate({ task, projectMap: map.text });
    } catch (error) {
        console.log(`⚠️ Оркестратор недоступен (${error.message}). Продолжаю без него: только @файлы, исполнитель по умолчанию.`);
        decision = { files: [], tier: 'fast', reason: 'orchestrator unavailable', subtaskPrompt: null };
    }

    let selectedTier = decision.tier;
    if (tagTier) selectedTier = tagTier;
    else if (forceFullAudit && selectedTier === 'fast') selectedTier = 'pro'; // a full audit does not fit a fast-model reply

    const routed = keepKnownFiles(decision.files, knownFiles);
    const relevantFiles = [...new Set([...inheritedFiles, ...forced, ...routed])];

    console.log(`🎯 Исполнитель: [${selectedTier.toUpperCase()}]${tagTier ? ' (задан тегом в задаче)' : ''} — ${decision.reason}`);
    if (relevantFiles.length > 0) {
        console.log(`📂 Files selected for analysis: ${relevantFiles.length}`);
        relevantFiles.forEach(f => console.log(`   - ${f}`));
    }

    return { ...base, relevantFiles, tier: selectedTier, tierForced: Boolean(tagTier), task, subtask: decision.subtaskPrompt };
}
