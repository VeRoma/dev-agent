import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { projectChildEnv } from '@veroma/ai-core/safety';
import { getStatePaths } from '../project/state-paths.js';

const OUTPUT_TAIL = 4000;
const MAVEN_TIMEOUT_MS = 15 * 60 * 1000;

function hasRealTestScript(cwd) {
    try {
        const script = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).scripts?.test;
        return Boolean(script) && !/no test specified/i.test(script);
    } catch {
        return false;
    }
}

/**
 * Environment for the target project's own test run: without the agent's secrets (LLM keys, bot token),
 * and without NODE_TEST_CONTEXT (set when this process runs under `node --test`), which turns a nested
 * `node --test` into a subtest that exits 0 even when tests fail.
 */
export function cleanTestEnv(env = process.env) {
    const { NODE_TEST_CONTEXT: _ignored, ...rest } = projectChildEnv(env).env;
    return rest;
}

/**
 * Maven modules to test: for every changed file, the nearest folder with pom.xml (inside the project).
 * @param {string} root
 * @param {Array<string|{path: string}>} updatedFiles
 * @returns {string[]} module paths relative to root ('' = the root itself)
 */
export function findMavenModules(root, updatedFiles = []) {
    const modules = new Set();
    for (const file of updatedFiles) {
        const relative = String(typeof file === 'string' ? file : file?.path ?? '').replace(/\\/g, '/');
        if (!relative) continue;
        let dir = path.posix.dirname(path.isAbsolute(relative) ? path.relative(root, relative).replace(/\\/g, '/') : relative);
        if (dir.startsWith('..')) continue;
        while (true) {
            const candidate = dir === '.' ? '' : dir;
            if (fs.existsSync(path.join(root, candidate, 'pom.xml'))) { modules.add(candidate); break; }
            if (dir === '.' || dir === '') break;
            dir = path.posix.dirname(dir);
        }
    }
    return [...modules].sort();
}

// The wrapper is called by its full path: cmd.exe does not search the current folder when
// NoDefaultCurrentDirectoryInExePath is set
function mavenCommand(moduleDir) {
    const wrapper = path.join(moduleDir, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
    return fs.existsSync(wrapper) ? `"${wrapper}" -B test` : 'mvn -B test';
}

// Maven always prints [INFO]/[ERROR] lines; without them it never started (no Java, no mvn on PATH)
const mavenStarted = (output) => /\[(INFO|ERROR|WARNING)\]/.test(output);

/** Keeps what explains a failure: Maven errors, test summaries and assertion messages. */
function mavenSummary(output) {
    const lines = output.split(/\r?\n/).filter(line =>
        /\[ERROR\]|Tests run:|FAIL|expected|but was|BUILD|Exception|COMPILATION/.test(line));
    return (lines.length > 0 ? lines.join('\n') : output).slice(-OUTPUT_TAIL);
}

/**
 * Assertion messages live in target/surefire-reports/*.txt; the console only names the failing line.
 * Only reports written by this run count: older ones (other test classes, manual runs) would mislead the model.
 */
export function surefireFailures(moduleDir, sinceMs = 0) {
    const dir = path.join(moduleDir, 'target', 'surefire-reports');
    let text = '';
    try {
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.txt'))) {
            const reportPath = path.join(dir, file);
            if (fs.statSync(reportPath).mtimeMs < sinceMs) continue;
            const report = fs.readFileSync(reportPath, 'utf-8');
            if (!/<<< (FAILURE|ERROR)!/.test(report)) continue;
            // Stack frames of the test framework add nothing: keep messages and the project's own frames
            const lines = report.split(/\r?\n/).filter(l => !/^\s+at (org\.junit|org\.mockito|java\.|jdk\.|org\.apache\.maven|sun\.)/.test(l));
            text += `\n--- ${file} ---\n${lines.join('\n').trim()}`;
        }
    } catch { /* no reports: compilation failed or Maven did not get that far */ }
    return text ? `\n\nSUREFIRE REPORTS:${text.slice(0, OUTPUT_TAIL)}` : '';
}

function run(command, cwd, timeout) {
    return new Promise((resolve) => {
        exec(command, { cwd, env: cleanTestEnv(), maxBuffer: 50 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
            resolve({ error, output: `${stdout}\n${stderr}` });
        });
    });
}

/**
 * Runs the target project's tests: `mvnw test` for the Maven modules of the changed files, otherwise `npm test`.
 * No test setup is not a code error.
 * @param {string} targetProject
 * @param {Array<string|{path: string}>} [updatedFiles]
 */
export async function runTests(targetProject, updatedFiles = []) {
    const { targetAbsolute } = getStatePaths(targetProject);

    const modules = findMavenModules(targetAbsolute, updatedFiles);
    if (modules.length > 0) {
        for (const moduleRelative of modules) {
            const cwd = path.join(targetAbsolute, moduleRelative);
            const command = mavenCommand(cwd);
            const label = `${moduleRelative || '.'}: ${command.includes('mvnw') ? 'mvnw' : 'mvn'} -B test`;
            console.log(`🧪 ${label} (без секретов агента в окружении)`);
            const startedAt = Date.now();
            const { error, output } = await run(command, cwd, MAVEN_TIMEOUT_MS);
            if (error) {
                if (!mavenStarted(output)) {
                    return { ok: true, output, warnings: [`Maven не запустился (${label}) — тесты пропущены`] };
                }
                return { ok: false, output: `${label}\n${mavenSummary(output)}${surefireFailures(cwd, startedAt)}`.slice(-OUTPUT_TAIL * 2) };
            }
        }
        return { ok: true, output: '' };
    }

    if (!hasRealTestScript(targetAbsolute)) {
        return { ok: true, output: '', warnings: ['в целевом проекте нет скрипта "test" — тесты пропущены'] };
    }

    const { error, output } = await run('npm test', targetAbsolute);
    // The tail of the output matters most; cut the rest
    return error ? { ok: false, output: output.slice(-OUTPUT_TAIL) } : { ok: true, output };
}
