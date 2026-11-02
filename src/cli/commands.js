import { config } from '../config.js';
import { getSession, clearSession, initSession } from '../engine/session.js';
import { processAgentTask } from '../engine/task-runner.js';
import { startSupervisedServer, stopDevServer } from '../engine/server-supervisor.js';
import { generateDocumentation } from '../project/history.js';
import { buildProjectMap } from '../project/project-map.js';
import { abortSessionPatches, applyRedoPatches, clearSessionBackups } from '../project/rollback.js';
import { resolveProject } from '../project/projects.js';
import { SELF_PROJECT, SELF_BRANCH, selfDiff } from '../project/self-workspace.js';
import { runTests } from '../engine/tester.js';
import { openProject } from './project-setup.js';

/** Switches the target project in a running session; on failure the current project stays. */
function switchProject(selector) {
    const name = resolveProject(selector);
    if (!name) {
        console.log('\n⚠️ Такого проекта нет. Пример: /p 3, /p имя-проекта, /p self');
        return;
    }
    stopDevServer({ quiet: true });
    try {
        openProject(name);
    } catch (error) {
        console.log(`\n❌ [ERROR] ${error.message}`);
        return;
    }
    initSession(`Project: ${name}`);
}

/**
 * /self-diff [full]: what the agent changed in the self worktree and whether its tests pass.
 * Only reports: merging into the running copy is always the developer's manual step.
 */
async function showSelfDiff(args) {
    const report = selfDiff();
    if (!report) {
        console.log('\n🪞 Worktree самоулучшения ещё не создан. Откройте проект self: /self');
        return;
    }

    console.log(`\n🪞 [SELF-DIFF] ${report.path} (ветка ${SELF_BRANCH}) против рабочей версии (${report.mainBranch})`);
    if (report.behind > 0) {
        console.log(`   ℹ️ Рабочая версия ушла вперёд на ${report.behind} коммит(ов) — они ниже не показаны.`);
    }
    if (!report.hasChanges) {
        console.log('   Изменений нет.');
        return;
    }

    if (report.commits.length > 0) {
        console.log(`\n   Коммиты (${report.commits.length}):`);
        report.commits.forEach(c => console.log(`     ${c}`));
    }
    if (report.stat) console.log(`\n   Изменённые файлы (включая незакоммиченные правки):\n${report.stat.replace(/^/gm, '     ')}`);
    if (report.untracked.length > 0) {
        console.log(`\n   Новые файлы (ещё не в git):`);
        report.untracked.forEach(f => console.log(`     + ${f}`));
    }
    if (args.trim().toLowerCase() === 'full' && report.diff) console.log(`\n${report.diff}`);
    else if (report.diff) console.log('\n   Полный diff: /self-diff full');

    console.log('\n🧪 Тесты worktree...');
    const tests = await runTests(report.path);
    (tests.warnings || []).forEach(w => console.log(`   ⚠️ ${w}`));
    const summary = tests.output.split('\n').filter(l => /^ℹ (tests|pass|fail)\b/.test(l)).join(' | ');
    console.log(tests.ok ? `   ✅ Тесты прошли. ${summary}` : `   ❌ Тесты упали. ${summary}\n${tests.output}`);

    const wt = report.path;
    console.log(`
📦 Выпуск новой версии — только вручную:
   1. Зафиксировать правки агента:  git -C "${wt}" add -A && git -C "${wt}" commit -m "<описание>"
   2. Влить в рабочую версию:       git merge ${SELF_BRANCH}     (в папке агента)
   3. По желанию — тег и отправка:  git tag vX.Y.Z && git push && git push --tags
   Отказаться от правок:            git -C "${wt}" reset --hard ${report.mainBranch} && git -C "${wt}" clean -fd`);
}

const DEFAULT_AUDIT_TASK =
    'Проведи полный архитектурный и security-аудит проекта. Найди мёртвые файлы, сломанные импорты, ' +
    'несовместимость модулей, дыры в безопасности (секреты в коде, инъекции, небезопасные команды) и рассинхрон логики. ' +
    'Выдай подробный структурный отчёт в режиме chat; ничего не меняй без отдельной задачи.';

const COMMANDS = {
    // "/audit" or "/audit <custom focus>": never handed to the fast tier
    '/audit': async (args) => {
        console.log('\n🔭 Запуск полного аудита проекта...');
        buildProjectMap();
        await processAgentTask(args || DEFAULT_AUDIT_TASK, 0, [], { forceFullAudit: true });
    },

    '/p': async (args) => switchProject(args),
    '/self': async () => switchProject(SELF_PROJECT),
    '/self-diff': async (args) => showSelfDiff(args),

    '/run': async () => startSupervisedServer(config.workspace.targetProject, processAgentTask),
    '/stop': async () => stopDevServer(),

    '/save': async () => {
        console.log('\n💾 Starting save process...');
        await generateDocumentation(config.workspace.targetProject, getSession());
        buildProjectMap();
        clearSession();
        clearSessionBackups();
        initSession('New task (waiting...)');
        console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
    },

    '/index': async () => {
        console.log('\n🗺️ Генерация карты проекта (мгновенно, без LLM)...');
        buildProjectMap();
    },

    '/abort': async () => {
        console.log('\n🗑️ Aborting current task...');
        await abortSessionPatches();
        clearSession();
        initSession('Task aborted (waiting...)');
        console.log('🛑 Task aborted. AI memory erased. Files reverted.');
    },

    '/redo': async () => {
        console.log('\n🔄 Restoring aborted task...');
        if (await applyRedoPatches()) {
            console.log('⏩ Task restored. AI memory reloaded. Files reverted to modified state.');
        }
    },

    '/clear': async () => {
        clearSession();
        initSession('Context cleared');
        console.log("\n🧹 AI memory cleared. Let's start a fresh topic!");
    },

    '/push': async () => {
        console.log('\n🚀 Preparing release...');
        console.log('   [To be implemented: generate commit message -> git add, commit, push]');
    },
};

export const COMMAND_NAMES = ['/editor', ...Object.keys(COMMANDS)];

/** Handles a slash command ("/name [arguments]"). An unknown command prints the help. */
export async function handleCommand(text) {
    const [name, ...rest] = text.trim().split(/\s+/);
    const handler = COMMANDS[name.toLowerCase()];
    if (!handler) {
        console.log(`\n⚠️ Unknown command. Available: ${COMMAND_NAMES.join(', ')}`);
        return;
    }
    await handler(rest.join(' '));
}
