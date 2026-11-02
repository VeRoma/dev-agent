import path from 'path';
import { ensureProjectMap } from '../project/project-map.js';
import { determineRelevantFiles } from './routing.js';

// Теги выбора модели выглядят как @упоминания, но файлами не являются
const IGNORED_TAGS = new Set(['7b', 'ds', 'deepseek', 'claude', 'gemini']);

/** @упоминания файлов в тексте; e-mail и служебные теги игнорируются. */
export function extractMentions(text) {
    return [...String(text).matchAll(/(?<![\w.])@([a-zA-Z0-9_.\-\/]+)/g)]
        .map(m => m[1].replace(/[.,;:]+$/, ''))
        .filter(m => m && !IGNORED_TAGS.has(m.toLowerCase()));
}

/** Ищет файл по упоминанию: имя, имя без расширения или хвост пути. */
export function resolveMention(mention, knownFiles) {
    return knownFiles.find((file) => {
        const normalized = file.replace(/\\/g, '/');
        const base = path.basename(normalized);
        const nameWithoutExt = base.replace(/\.[^/.]+$/, '');
        return base === mention || nameWithoutExt === mention || normalized === mention || normalized.endsWith(mention);
    });
}

/**
 * Собирает контекст задачи: карта проекта, файлы из @упоминаний и файлы, выбранные диспетчером.
 * @returns {Promise<{projectMapText: string, knownFiles: string[], relevantFiles: string[]}>}
 */
export async function selectFiles(text, targetProject) {
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

    const dispatched = await determineRelevantFiles(text, targetProject);
    const relevantFiles = [...new Set([...forced, ...dispatched])];

    if (relevantFiles.length > 0) {
        console.log(`📂 Files selected for analysis: ${relevantFiles.length}`);
        relevantFiles.forEach(f => console.log(`   - ${path.basename(f)}`));
    }

    return { projectMapText: map.text, knownFiles, relevantFiles };
}
