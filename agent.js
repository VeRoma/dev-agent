import fs from 'fs';
import path from 'path';
import { acquireProjectLock } from '@veroma/ai-core/lock';
import { setTargetProject } from './src/config.js';
import { listProjects, resolveProject, projectPath, PROJECTS_DIR } from './src/project/projects.js';
import { getStatePaths, STATE_DIR_NAME } from './src/project/state-paths.js';
import { readProjectMap, buildProjectMap } from './src/project/project-map.js';
import { ask, closeTerminal } from './src/cli/terminal.js';
import { startCLI } from './src/cli/chat-loop.js';

function fail(message) {
    console.error(`\n❌ [ERROR] ${message}`);
    process.exit(1);
}

async function chooseProject() {
    let projects;
    try {
        projects = listProjects();
    } catch (error) {
        fail(`Не удалось прочитать папку проектов ${PROJECTS_DIR}: ${error.message}`);
    }
    if (projects.length === 0) fail(`В ${PROJECTS_DIR} нет проектов.`);

    // Режим Telegram: проект приходит из окружения (имя или номер)
    if (process.env.AUTO_PROJECT) {
        const selected = resolveProject(process.env.AUTO_PROJECT, projects);
        if (!selected) fail(`Проект "${process.env.AUTO_PROJECT}" не найден среди: ${projects.join(', ')}`);
        console.log(`\n🤖 [AGENT] АВТО-РЕЖИМ: Выбран проект: ${selected}`);
        return selected;
    }

    console.log('\nℹ️ [INFO] Доступные проекты:');
    projects.forEach((name, i) => console.log(`   ${i + 1}. ${name}`));

    const answer = await ask('\n❓ [PROMPT] С каким проектом работаем сегодня? (номер или имя): ');
    const selected = resolveProject(answer, projects);
    if (!selected) fail('Неверный выбор проекта. Выход.');
    return selected;
}

function prepareProject(name) {
    setTargetProject(projectPath(name));
    const { targetAbsolute, stateDir } = getStatePaths();
    console.log(`\n✅ [SUCCESS] Выбран проект: ${name}`);

    // Один агент на проект: задача из Telegram, пока открыт терминал, перезаписывала бы те же файлы
    const lock = acquireProjectLock(stateDir);
    if (!lock.ok) fail(`С проектом ${name} уже работает другой Dev-Agent (pid ${lock.pid}). Дождитесь его завершения.`);

    if (!readProjectMap()) {
        console.log('ℹ️ [INFO] Карта проекта не найдена, строю...');
        try { buildProjectMap(); } catch (error) { console.log(`⚠️ [WARN] Не удалось построить карту: ${error.message}`); }
    }

    // Состояние агента не должно попасть в репозиторий проекта
    const gitignore = path.join(targetAbsolute, '.gitignore');
    const ignored = fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf-8').includes(STATE_DIR_NAME);
    if (!ignored) {
        console.log(`⚠️ [WARN] В .gitignore проекта нет ${STATE_DIR_NAME}/ — добавьте, чтобы сессии и бэкапы не попали в git.`);
    }
}

async function main() {
    console.log('\n========================================');
    console.log('🤖 [AGENT] DEV-AGENT CLI');
    console.log('========================================');

    prepareProject(await chooseProject());

    // Директива от Telegram-бота приходит в окружении только этого процесса:
    // ручной запуск никогда не подхватит чужую задачу
    const task = process.env.DEV_TASK?.trim();
    if (task) {
        closeTerminal();
        await startCLI(task);
        return;
    }

    await startCLI();
}

main().catch((error) => fail(`Критическая ошибка: ${error.message}`));
