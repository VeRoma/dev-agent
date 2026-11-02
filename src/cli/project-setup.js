import fs from 'fs';
import path from 'path';
import { acquireProjectLock } from '@veroma/ai-core/lock';
import { setTargetProject } from '../config.js';
import { projectPath } from '../project/projects.js';
import { getStatePaths, STATE_DIR_NAME } from '../project/state-paths.js';
import { readProjectMap, buildProjectMap } from '../project/project-map.js';
import { SELF_PROJECT, SELF_BRANCH, ensureSelfWorkspace, assertNotAgentRoot } from '../project/self-workspace.js';

let currentLock = null;

/**
 * Makes the project the agent's target: worktree (self mode), lock, project map, .gitignore check.
 * Releases the previous project's lock on a switch. Throws if the project cannot be opened;
 * on failure the previous project stays active.
 */
export function openProject(name) {
    let target = projectPath(name);
    if (name === SELF_PROJECT) {
        const ws = ensureSelfWorkspace();
        target = ws.path;
        console.log(`\n🪞 [SELF] Режим самоулучшения: правки идут в ${ws.path} (ветка ${ws.branch}), запущенная копия агента не меняется.`);
        if (ws.created) console.log('🪞 [SELF] Worktree создан.');
        if (ws.updated) console.log('🪞 [SELF] Worktree обновлён до текущей версии агента.');
        if (ws.ahead > 0) console.log(`🪞 [SELF] В ${SELF_BRANCH} ${ws.ahead} коммит(ов), ещё не слитых в рабочую версию.`);
    }

    const { targetAbsolute, stateDir } = getStatePaths(target);
    assertNotAgentRoot(targetAbsolute);

    // One agent per project: a Telegram task while the terminal is open would overwrite the same files
    const lock = acquireProjectLock(stateDir);
    if (!lock.ok) throw new Error(`С проектом ${name} уже работает другой Dev-Agent (pid ${lock.pid}). Дождитесь его завершения.`);

    currentLock?.release();
    currentLock = lock;
    setTargetProject(target);
    console.log(`\n✅ [SUCCESS] Выбран проект: ${name}`);

    if (!readProjectMap()) {
        console.log('ℹ️ [INFO] Карта проекта не найдена, строю...');
        try { buildProjectMap(); } catch (error) { console.log(`⚠️ [WARN] Не удалось построить карту: ${error.message}`); }
    }

    // Agent state must not end up in the project's repository
    const gitignore = path.join(targetAbsolute, '.gitignore');
    const ignored = fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf-8').includes(STATE_DIR_NAME);
    if (!ignored) {
        console.log(`⚠️ [WARN] В .gitignore проекта нет ${STATE_DIR_NAME}/ — добавьте, чтобы сессии и бэкапы не попали в git.`);
    }
}
