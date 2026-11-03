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

/**
 * Environment for the target project's own test run. NODE_TEST_CONTEXT (set when this process runs
 * under `node --test`) turns a nested `node --test` into a subtest that exits 0 even when tests fail.
 */
export function cleanTestEnv(env = process.env) {
    const { NODE_TEST_CONTEXT: _ignored, ...rest } = env;
    return rest;
}

/** Runs `npm test` of the target project. No test script is not a code error. */
export function runTests(targetProject) {
    const { targetAbsolute } = getStatePaths(targetProject);

    if (!hasRealTestScript(targetAbsolute)) {
        return Promise.resolve({ ok: true, output: '', warnings: ['в целевом проекте нет скрипта "test" — тесты пропущены'] });
    }

    return new Promise((resolve) => {
        exec('npm test', { cwd: targetAbsolute, env: cleanTestEnv(), maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                // The tail of the output matters most; cut the rest
                return resolve({ ok: false, output: (stdout + '\n' + stderr).slice(-4000) });
            }
            resolve({ ok: true, output: stdout });
        });
    });
}
