import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getStatePaths } from '../project/state-paths.js';

const OUTPUT_TAIL = 8000;  // сколько последнего вывода держать для модели
let currentProcess = null;
let lastErrorAt = 0;       // антиспам: не дёргаем авто-исправление чаще, чем раз в 5 секунд
let logTailInterval = null;

// Падение, а не просто слово «error» в логе: строка обработанной ошибки, «0 failed»
// или логгер с errorHandler не должны запускать правку кода.
const NODE_CRASH_RE = /\[nodemon\] app crashed/i;
const JAVA_STARTUP_FAILURE_RE = /APPLICATION FAILED TO START|BUILD FAILURE|Error starting ApplicationContext|Exception in thread "main"/;

/** nodemon и подобные не завершаются при падении приложения, а ждут изменений — это тоже падение. */
export function isNodeCrashOutput(text) {
    return NODE_CRASH_RE.test(text);
}

/** Spring Boot / Maven: только признаки того, что приложение не поднялось. */
export function isJavaStartupFailure(text) {
    return JAVA_STARTUP_FAILURE_RE.test(text);
}

function reportCrash(onErrorCallback, log) {
    const now = Date.now();
    if (now - lastErrorAt <= 5000) return;
    lastErrorAt = now;
    onErrorCallback(log.slice(-OUTPUT_TAIL));
}

// Где запускать: backend/start.ps1 (Java), start.ps1, package.json в корне либо в первой подпапке
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
        // --- РЕЖИМ JAVA (SPRING BOOT) ---
        try { execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: runPath, stdio: 'ignore' }); } catch { /* не запущено */ }

        console.log('⚙️ Выполняю start.ps1...');
        execSync('powershell -ExecutionPolicy Bypass -File .\\start.ps1', { cwd: runPath });
        currentProcess = { isJava: true, runPath };

        // Ищем свежий лог-файл (server_*.log) и "хвостим" его
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

    // --- РЕЖИМ NODE.JS ---
    const script = pickNpmScript(runPath);
    console.log(`⚙️ Выполняю npm run ${script}...`);

    const child = spawn('npm', ['run', script], { cwd: runPath, shell: true });
    currentProcess = child;
    const onOutput = (data) => {
        if (isNodeCrashOutput(collect(data))) reportCrash(onErrorCallback, log);
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('close', (code) => {
        // Обнуляем только если это всё ещё ТЕКУЩИЙ процесс (после рестарта старый закрывается позже нового)
        if (currentProcess === child) currentProcess = null;
        // Остановка через /stop или рестарт — не падение (taskkill тоже даёт ненулевой код)
        if (child.stoppedByAgent) return;
        if (code !== 0 && code !== null) {
            console.log(`\n💥 Целевой процесс завершился с кодом ${code}.`);
            reportCrash(onErrorCallback, log);
        }
    });
}

export function stopDevServer() {
    if (!currentProcess) {
        console.log('\n⚠️ Нет запущенных процессов.');
        return;
    }

    console.log('\n🛑 Убиваю целевой процесс...');
    if (currentProcess.isJava) {
        try { execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: currentProcess.runPath, stdio: 'ignore' }); } catch { /* уже остановлен */ }
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
