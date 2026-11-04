import { config } from '../config.js';
import { getStatePaths } from '../project/state-paths.js';
import { readFilesContent } from '../project/file-manager.js';
import { beginTask } from '../project/backups.js';
import { resetUsage, getUsage, formatUsage } from '../llm/usage.js';
import { appendToSession, getSession, compressSessionIfNeeded } from './session.js';
import { selectContext, extractMentions, resolveMention } from './context-builder.js';
import { buildPrompt } from './prompt.js';
import { askAgent } from './executor.js';
import { runPatch } from './patch-pipeline.js';
import { runCommands } from './command-runner.js';
import { restartSupervisedServer } from './server-supervisor.js';

const MAX_HEALING_ATTEMPTS = 3;  // how many times the agent may fix its own errors
const MAX_AUTO_DEPTH = 3;        // how many times in a row the system auto-loads files the agent asked for
const FAILURES_BEFORE_ESCALATION = 2;
const ESCALATION = { fast: 'pro', pro: 'arch' }; // cheap model first, a stronger one only where it failed

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
 * "chat" mode: show the reply; if the agent asks for files via @ — load them and continue.
 * @returns {Promise<boolean>} true if the continuation ran as a recursive call
 */
async function handleChat(parsed, { knownFiles, relevantFiles, depth, tier, tierForced, targetAbsolute }) {
    banner('CHAT');
    console.log(parsed.message);
    footer();
    appendToSession('agent', parsed.message);

    // A reply without file changes may still carry commands (git commit, git status): they used to be dropped silently
    const commands = parsed.commandsToRun || [];
    if (commands.length > 0) await runCommands(commands, { cwd: targetAbsolute });

    const newFiles = extractMentions(parsed.message || '')
        .map(mention => resolveMention(mention, knownFiles))
        .filter(Boolean)
        .filter(file => !relevantFiles.includes(file));

    if (newFiles.length > 0 && depth < MAX_AUTO_DEPTH) {
        console.log('\n⚙️ [SYSTEM] Система подтягивает файлы для агента...');
        // Same executor as chosen for the task: otherwise a Claude task would continue on DeepSeek
        await processAgentTask(
            `[SYSTEM] Дополнительно загружены файлы: ${newFiles.map(f => `@${f}`).join(' ')}. Продолжай задачу (используй mode: "patch", если готов).`,
            depth + 1,
            relevantFiles,
            { tier, tierForced },
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
 * "patch" mode: one pipeline pass and the decision what to do next.
 * @returns {{done: boolean, failed?: boolean, extraFiles?: string[]}} done=false — one more fixing round is needed
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

        case 'commit_failed':
            // Not "completed": the model must not believe its changes are on disk
            appendToSession('agent', `[PATCH NOT APPLIED — the previous step's commit failed]: ${parsed.message}`);
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
            appendToSession('user', `[SYSTEM ERROR] Your patch was rejected and NOTHING was written to disk:\n${reasons}\nFix the reasons above and send the patch again. CODE CONTEXT shows the files as they are now: copy every "search" verbatim from there. "content" must be the COMPLETE file (no placeholders like "rest of code unchanged"). Use project-relative paths inside the project.`);
            return { done: false, failed: true };
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
            return { done: false, failed: true, extraFiles: result.updatedPaths };
    }
    return { done: true };
}

/** Moves the task one tier up after repeated failures on the current tier (unless the tier was forced by a tag). */
function escalate(state) {
    state.failuresOnTier++;
    const next = ESCALATION[state.tier];
    if (state.tierForced || !next || state.failuresOnTier < FAILURES_BEFORE_ESCALATION) return;
    console.log(`⬆️ [ESCALATION] ${state.failuresOnTier} неудачи подряд на уровне ${state.tier.toUpperCase()} — передаю задачу уровню ${next.toUpperCase()}.`);
    state.tier = next;
    state.failuresOnTier = 0;
}

/**
 * Main task loop: orchestrator -> executor -> (chat | patch -> checks -> self-healing with escalation).
 * @param {string[]} [inheritedFiles] files already loaded (auto-loading continuation)
 * @param {{tier?: string, tierForced?: boolean, forceFullAudit?: boolean}} [options]
 */
export async function processAgentTask(text, depth = 0, inheritedFiles = [], options = {}) {
    if (depth === 0) {
        resetUsage();
        beginTask(text); // auto-loading continuations (depth > 0) stay in the same /undo step
    }
    console.log('🤖 [AGENT] Gathering context...');
    appendToSession('user', text);

    try {
        const targetProject = config.workspace.targetProject;
        const { targetAbsolute } = getStatePaths(targetProject);
        const ctx = await selectContext(text, targetProject, { depth, inheritedFiles, ...options });
        const state = { tier: ctx.tier, tierForced: ctx.tierForced, failuresOnTier: 0 };
        let relevantFiles = ctx.relevantFiles;

        for (let attempt = 0; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
            const prompt = buildPrompt({
                projectMapText: ctx.projectMapText,
                filesContext: readFilesContent(relevantFiles, targetAbsolute),
                sessionContext: getSession(),
                task: ctx.task,
                subtask: ctx.subtask,
            });

            console.log(attempt > 0
                ? `🤖 [AGENT] Executor (${state.tier.toUpperCase()}) is fixing errors (Attempt ${attempt}/${MAX_HEALING_ATTEMPTS})...`
                : `🤖 [AGENT] Executor (${state.tier.toUpperCase()}) is thinking/coding...`);

            let parsed;
            try {
                parsed = await askAgent(prompt, state.tier, attempt > 0 ? `${state.tier} fix` : state.tier);
            } catch (error) {
                // No valid JSON even after the retry and all fallbacks: count as a failure, maybe escalate
                // No model can answer at all (no credits, output limit): more attempts would only repeat it
                if (attempt >= MAX_HEALING_ATTEMPTS || error.code === 'NO_MODELS_AVAILABLE') throw error;
                console.log(`⚠️ [WARN] Исполнитель не дал корректный ответ: ${error.message}`);
                escalate(state);
                continue;
            }
            printPlan(parsed.plan);

            if (parsed.mode === 'chat') {
                await handleChat(parsed, { knownFiles: ctx.knownFiles, relevantFiles, depth, tier: state.tier, tierForced: state.tierForced, targetAbsolute });
                break;
            }

            if (parsed.mode === 'patch') {
                const step = await handlePatch(parsed, attempt, { targetProject, targetAbsolute });
                if (step.done) break;
                if (step.failed) escalate(state);
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

    if (depth > 0) return; // the top-level call compresses the session and prints usage once
    await compressSessionIfNeeded();
    const summary = formatUsage(getUsage(), config.llm.pricing);
    if (summary) console.log(`\n${summary}`);
}
