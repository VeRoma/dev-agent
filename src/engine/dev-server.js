import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getStatePaths } from '../project/state-paths.js';
import { projectChildEnv } from '@veroma/ai-core/safety';

const OUTPUT_TAIL = 8000;  // how much of the latest output to keep for the model
let currentProcess = null;
let lastErrorAt = 0;       // anti-spam: trigger auto-fix at most once per 5 seconds
let logTailInterval = null;

// A crash, not just the word "error" in the log: a handled error line, "0 failed"
// or a logger with errorHandler must not trigger a code fix.
const NODE_CRASH_RE = /\[nodemon\] app crashed/i;
const JAVA_STARTUP_FAILURE_RE = /APPLICATION FAILED TO START|BUILD FAILURE|Error starting ApplicationContext|Exception in thread "main"/;

/** nodemon and similar do not exit when the app crashes, they wait for changes; that is a crash too. */
export function isNodeCrashOutput(text) {
    return NODE_CRASH_RE.test(text);
}

/** Spring Boot / Maven: only signs that the app failed to start. */
export function isJavaStartupFailure(text) {
    return JAVA_STARTUP_FAILURE_RE.test(text);
}

function reportCrash(onErrorCallback, log) {
    const now = Date.now();
    if (now - lastErrorAt <= 5000) return;
    lastErrorAt = now;
    onErrorCallback(log.slice(-OUTPUT_TAIL));
}

// Where to run: backend/start.ps1 (Java), start.ps1, package.json in the root or the first subfolder
function locateRunTarget(rootPath) {
    if (fs.existsSync(path.join(rootPath, 'backend', 'start.ps1'))) return { runPath: path.join(rootPath, 'backend'), isJava: true };
    if (fs.existsSync(path.join(rootPath, 'start.ps1'))) return { runPath: rootPath, isJava: true };
    if (!fs.existsSync(path.join(rootPath, 'package.json'))) {
        for (const item of fs.readdirSync(rootPath)) {
            const subPath = path.join(rootPath, item);
            if (fs.statSync(subPath).isDirectory() && fs.existsSync(path.join(subPath, 'package.json'))) {
                return { runPath: subPath, isJava: false };
            }
        }
    }
    return { runPath: rootPath, isJava: false };
}

function pickNpmScript(runPath) {
    try {
        const scripts = JSON.parse(fs.readFileSync(path.join(runPath, 'package.json'), 'utf-8')).scripts ?? {};
        return ['dev', 'start', 'agent'].find(name => scripts[name]) ?? 'dev';
    } catch {
        return 'dev';
    }
}

export function runDevServer(targetProject, onErrorCallback) {
    if (currentProcess) {
        console.log('\n⚠️ Процесс уже запущен. Введите /stop для остановки.');
        return;
    }

    const { targetAbsolute } = getStatePaths(targetProject);
    const { runPath, isJava } = locateRunTarget(targetAbsolute);
    console.log(`\n🚀 Запускаю процесс в: ${runPath}`);

    let log = '';
    const collect = (data) => {
        const output = data.toString();
        process.stdout.write(`[TARGET] ${output}`);
        log = (log + output).slice(-OUTPUT_TAIL);
        return output;
    };

    if (isJava) {
        // --- JAVA MODE (SPRING BOOT) ---
        try { execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: runPath, stdio: 'ignore' }); } catch { /* not running */ }

        console.log('⚙️ Выполняю start.ps1...');
        execSync('powershell -ExecutionPolicy Bypass -File .\\start.ps1', { cwd: runPath, env: projectChildEnv().env });
        currentProcess = { isJava: true, runPath };

        // Find the latest log file (server_*.log) and tail it
        setTimeout(() => {
            const logs = fs.readdirSync(runPath).filter(f => f.startsWith('server_') && f.endsWith('.log'));
            if (logs.length === 0) return;

            const latestLog = path.join(runPath, logs.sort().reverse()[0]);
            let lastSize = fs.statSync(latestLog).size;
            logTailInterval = setInterval(() => {
                if (!fs.existsSync(latestLog)) return;
                const size = fs.statSync(latestLog).size;
                if (size > lastSize) {
                    fs.createReadStream(latestLog, { start: lastSize, end: size }).on('data', (chunk) => {
                        if (isJavaStartupFailure(collect(chunk))) reportCrash(onErrorCallback, log);
                    });
                    lastSize = size;
                }
            }, 1000);
        }, 2000);
        return;
    }

    // --- NODE.JS MODE ---
    const script = pickNpmScript(runPath);
    console.log(`⚙️ Выполняю npm run ${script}...`);

    const child = spawn('npm', ['run', script], { cwd: runPath, shell: true, env: projectChildEnv().env });
    currentProcess = child;
    const onOutput = (data) => {
        if (isNodeCrashOutput(collect(data))) reportCrash(onErrorCallback, log);
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('close', (code) => {
        // Reset only if this is still the CURRENT process (after a restart the old one closes after the new one)
        if (currentProcess === child) currentProcess = null;
        // A stop via /stop or a restart is not a crash (taskkill also yields a non-zero code)
        if (child.stoppedByAgent) return;
        if (code !== 0 && code !== null) {
            console.log(`\n💥 Целевой процесс завершился с кодом ${code}.`);
            reportCrash(onErrorCallback, log);
        }
    });
}

/** @param {{quiet?: boolean}} [options] quiet: no warning when nothing runs (exit, project switch, restart) */
export function stopDevServer({ quiet = false } = {}) {
    if (!currentProcess) {
        if (!quiet) console.log('\n⚠️ Нет запущенных процессов.');
        return;
    }

    console.log('\n🛑 Убиваю целевой процесс...');
    if (currentProcess.isJava) {
        try { execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: currentProcess.runPath, stdio: 'ignore' }); } catch { /* already stopped */ }
        if (logTailInterval) { clearInterval(logTailInterval); logTailInterval = null; }
    } else {
        currentProcess.stoppedByAgent = true;
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', currentProcess.pid, '/f', '/t']);
        } else {
            currentProcess.kill();
        }
    }
    currentProcess = null;
}
