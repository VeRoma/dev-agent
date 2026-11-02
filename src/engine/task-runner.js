import { config } from '../config.js';
import { getStatePaths } from '../project/state-paths.js';
import { readFilesContent } from '../project/file-manager.js';
import { appendToSession, getSession, compressSessionIfNeeded } from './session.js';
import { selectFiles, extractMentions, resolveMention } from './context-builder.js';
import { buildPrompt } from './prompt.js';
import { askAgent } from './executor.js';
import { runPatch } from './patch-pipeline.js';
import { restartSupervisedServer } from './server-supervisor.js';

const MAX_HEALING_ATTEMPTS = 3; // сколько раз агент может исправлять собственные ошибки
const MAX_AUTO_DEPTH = 3;       // сколько раз подряд система сама подгружает файлы по просьбе агента

const banner = (title) => console.log(`\n================ AGENT RESPONSE [${title}] ================`);
const footer = () => console.log('========================================================\n');

function printPlan(plan) {
    if (!Array.isArray(plan) || plan.length === 0) return;
    console.log("\n🤖 [AGENT] Logic & Plan:");
    plan.forEach(step => console.log(`   🔸 ${step}`));
}

function restartIfRequested(parsed) {
    if (parsed.restartServer) {
        restartSupervisedServer(config.workspace.targetProject, processAgentTask);
    }
}

/**
 * Режим «chat»: показать ответ; если агент просит файлы через @ — подгрузить и продолжить.
 * @returns {Promise<boolean>} true, если продолжение выполнено рекурсивным вызовом
 */
async function handleChat(parsed, { knownFiles, relevantFiles, depth }) {
    banner('CHAT');
    console.log(parsed.message);
    footer();
    appendToSession('agent', parsed.message);

    const newFiles = extractMentions(parsed.message || '')
        .map(mention => resolveMention(mention, knownFiles))
        .filter(Boolean)
        .filter(file => !relevantFiles.includes(file));

    if (newFiles.length > 0 && depth < MAX_AUTO_DEPTH) {
        // Preserve ALL files accumulated so far, not only the new ones: the recursive
        // processAgentTask rebuilds its file list from scratch, so previously loaded
        // files must be re-mentioned explicitly to survive the recursion boundary.
        const accumulatedFiles = [...new Set([...relevantFiles, ...newFiles])];
        console.log('\n⚙️ [SYSTEM] Система подтягивает файлы для агента...');
        await processAgentTask(
            `[SYSTEM] Файлы загружены: ${accumulatedFiles.map(f => `@${f}`).join(' ')}. Продолжай задачу (используй mode: "patch", если готов).`,
            depth + 1,
        );
        return true;
    }
    if (newFiles.length > 0) {
        console.log(`\n⚠️ [WARN] Достигнут лимит автоматической подгрузки файлов (${MAX_AUTO_DEPTH}). Уточните запрос или упомяните нужные файлы через @.`);
    }
    restartIfRequested(parsed);
    return false;
}

/**
 * Режим «patch»: один проход конвейера и решение, что делать дальше.
 * @returns {{done: boolean, extraFiles?: string[]}} done=false — нужен ещё один круг исправления
 */
async function handlePatch(parsed, attempt, ctx) {
    banner('PATCH');
    console.log(`🤖 [AGENT] ${parsed.message}`);
    footer();

    const result = await runPatch(parsed, ctx);
    const canRetry = attempt < MAX_HEALING_ATTEMPTS;

    switch (result.outcome) {
        case 'empty':
        case 'completed':
            console.log('✅ [SUCCESS] Задача завершена.');
            appendToSession('agent', `[TASK COMPLETED]: ${parsed.message}`);
            restartIfRequested(parsed);
            return { done: true };

        case 'clean':
            console.log('✅ [SUCCESS] Проверки пройдены. Код чист.');
            appendToSession('agent', `[PATCH APPLIED SUCCESSFULLY]: ${parsed.message}`);
            restartIfRequested(parsed);
            return { done: true };

        case 'rejected': {
            appendToSession('agent', `[PATCH REJECTED]: ${parsed.message}`);
            if (!canRetry) {
                console.log('❌ [ERROR] Не удалось получить корректный патч. Требуется ручное вмешательство.');
                return { done: true };
            }
            const reasons = result.rejected.map(r => `- ${r.path}: ${r.reason}`).join('\n');
            console.log(`⚠️ [WARN] Патч отклонён защитой. Запрашиваю исправленный вариант (Attempt ${attempt + 1}/${MAX_HEALING_ATTEMPTS})...`);
            appendToSession('user', `[SYSTEM ERROR] Your patch was rejected and NOTHING was written to disk:\n${reasons}\nReturn the COMPLETE content of every file (no placeholders like "rest of code unchanged") using project-relative paths inside the project.`);
            return { done: false };
        }

        case 'check_failed':
            if (!canRetry) {
                console.log('❌ [ERROR] Авто-исправление не удалось. Требуется ручное вмешательство.');
                console.log(`\n❌ [ERROR] ${result.kind.toUpperCase()} Output:\n${result.output}\n`);
                appendToSession('agent', `[PATCH APPLIED BUT ${result.kind.toUpperCase()} FAILED]: ${parsed.message}`);
                return { done: true };
            }
            console.log(`⚠️ [WARN] ${result.kind}: обнаружены ошибки. Запуск модуля исправления...`);
            appendToSession('agent', `[PATCH APPLIED WITH ERRORS]: ${parsed.message}`);
            appendToSession('user', `[SYSTEM ERROR] ${result.kind} failed on the code you just wrote. Fix these errors in "patch" mode:\n\n${result.output}`);
            return { done: false, extraFiles: result.updatedPaths };
    }
    return { done: true };
}

/** Главный цикл задачи: контекст -> модель -> (чат | патч -> проверки -> самолечение). */
export async function processAgentTask(text, depth = 0) {
    console.log('🤖 [AGENT] Gathering context...');
    appendToSession('user', text);

    try {
        const targetProject = config.workspace.targetProject;
        const { targetAbsolute } = getStatePaths(targetProject);
        const { projectMapText, knownFiles, relevantFiles: selected } = await selectFiles(text, targetProject);
        let relevantFiles = selected;

        for (let attempt = 0; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
            const prompt = buildPrompt({
                projectMapText,
                filesContext: readFilesContent(relevantFiles, targetAbsolute),
                sessionContext: getSession(),
            });

            console.log(attempt > 0
                ? `🤖 [AGENT] Executor is fixing errors (Attempt ${attempt}/${MAX_HEALING_ATTEMPTS})...`
                : '🤖 [AGENT] Executor is thinking/coding...');

            const parsed = await askAgent(prompt);
            printPlan(parsed.plan);

            if (parsed.mode === 'chat') {
                const continued = await handleChat(parsed, { knownFiles, relevantFiles, depth });
                if (continued) return; // продолжение выполнил рекурсивный вызов (он сам сожмёт сессию)
                break;
            }

            if (parsed.mode === 'patch') {
                const step = await handlePatch(parsed, attempt, { targetProject, targetAbsolute });
                if (step.done) break;
                if (step.extraFiles) relevantFiles = [...new Set([...relevantFiles, ...step.extraFiles])];
                continue;
            }

            console.log(parsed.message || 'No message provided.');
            appendToSession('agent', JSON.stringify(parsed));
            break;
        }
    } catch (error) {
        console.error('\n❌ [ERROR] Ошибка обработки задачи:', error.message);
    }

    await compressSessionIfNeeded();
}
