import { config } from './src/config.js';
import { scanProjects, resolveProject, noAccessMessage, inaccessibleLabel, PROJECTS_DIR } from './src/project/projects.js';
import { SELF_BRANCH } from './src/project/self-workspace.js';
import { ask, closeTerminal } from './src/cli/terminal.js';
import { startCLI } from './src/cli/chat-loop.js';
import { reportModels } from './src/cli/model-report.js';
import { openProject } from './src/cli/project-setup.js';

function fail(message) {
    console.error(`\n❌ [ERROR] ${message}`);
    process.exit(1);
}

async function chooseProject() {
    let projects, inaccessible;
    try {
        ({ projects, inaccessible } = scanProjects());
    } catch (error) {
        fail(`Не удалось прочитать папку проектов ${PROJECTS_DIR}: ${error.message}`);
    }

    // Telegram mode: the project comes from the environment (name, number or "self")
    if (process.env.AUTO_PROJECT) {
        const selected = resolveProject(process.env.AUTO_PROJECT, projects);
        if (!selected) {
            fail(noAccessMessage(process.env.AUTO_PROJECT, inaccessible)
                ?? `Проект "${process.env.AUTO_PROJECT}" не найден среди: self, ${projects.join(', ')}`);
        }
        console.log(`\n🤖 [AGENT] АВТО-РЕЖИМ: Выбран проект: ${selected}`);
        return selected;
    }

    console.log('\nℹ️ [INFO] Доступные проекты:');
    console.log(`   0. self — сам dev-agent (правки в отдельном worktree, ветка ${SELF_BRANCH})`);
    projects.forEach((name, i) => console.log(`   ${i + 1}. ${name}`));
    inaccessible.forEach((name) => console.log(`   ${inaccessibleLabel(name)}`));

    const answer = await ask('\n❓ [PROMPT] С каким проектом работаем сегодня? (номер или имя): ');
    const selected = resolveProject(answer, projects);
    if (!selected) fail(noAccessMessage(answer, inaccessible) ?? 'Неверный выбор проекта. Выход.');
    return selected;
}

async function main() {
    console.log('\n========================================');
    console.log('🤖 [AGENT] DEV-AGENT CLI');
    console.log('========================================');

    await reportModels(config.llm);
    try {
        openProject(await chooseProject());
    } catch (error) {
        fail(error.message);
    }

    // A Telegram directive arrives in this process's environment only:
    // a manual start never picks up someone else's task
    const task = process.env.DEV_TASK?.trim();
    if (task) {
        closeTerminal();
        await startCLI(task);
        return;
    }

    await startCLI();
}

main().catch((error) => fail(`Критическая ошибка: ${error.message}`));
