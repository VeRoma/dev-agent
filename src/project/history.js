import fs from 'fs';
import path from 'path';
import { askModel } from '../llm/index.js';
import { getStatePaths } from './state-paths.js';

/** Дописывает итоги сессии в HISTORY.md проекта (английский, стиль Conventional Commits). */
export async function generateDocumentation(targetProject, sessionContext) {
    if (!sessionContext || sessionContext.trim() === '') {
        console.log('⚠️ Session is empty, nothing to save.');
        return;
    }

    const prompt = `
You are a technical writer and senior developer. Analyze the raw log of a working session between a developer and an AI.
Extract ONLY the final, successful decisions, solutions, and code modifications made to the project.
Completely ignore intermediate errors, non-working code drafts, and casual conversation.

Format the output as a concise, technical summary in a Markdown list (use bullet points, no top-level headers).

CRITICAL INSTRUCTION: Write the final summary STRICTLY IN ENGLISH, following Conventional Commits style where possible (e.g., feat, fix, refactor).

RAW SESSION LOG:
${sessionContext}
`;

    console.log('🤖 Analyzing session and generating documentation...');

    try {
        const summary = await askModel(prompt, true);
        const { targetAbsolute } = getStatePaths(targetProject);
        const date = new Date().toISOString().split('T')[0];
        fs.appendFileSync(path.join(targetAbsolute, 'HISTORY.md'), `\n### [${date}]\n${summary}\n`, 'utf-8');
        console.log('✅ Final solution successfully written to HISTORY.md!');
    } catch (error) {
        console.error('❌ Error generating documentation:', error.message);
    }
}
