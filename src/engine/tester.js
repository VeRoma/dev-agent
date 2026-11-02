import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getStatePaths } from '../project/state-paths.js';

function hasRealTestScript(cwd) {
    try {
        const script = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).scripts?.test;
        return Boolean(script) && !/no test specified/i.test(script);
    } catch {
        return false;
    }
}

/** Запускает `npm test` целевого проекта. Нет скрипта test — это не ошибка кода. */
export function runTests(targetProject) {
    const { targetAbsolute } = getStatePaths(targetProject);

    if (!hasRealTestScript(targetAbsolute)) {
        return Promise.resolve({ ok: true, output: '', warnings: ['в целевом проекте нет скрипта "test" — тесты пропущены'] });
    }

    return new Promise((resolve) => {
        exec('npm test', { cwd: targetAbsolute, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                // Хвост вывода — самое важное, лишнее режем
                return resolve({ ok: false, output: (stdout + '\n' + stderr).slice(-4000) });
            }
            resolve({ ok: true, output: stdout });
        });
    });
}
