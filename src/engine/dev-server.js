import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getStatePaths } from '../project/state-paths.js';

let currentProcess = null;
let lastErrorAt = 0; // антиспам: не дёргаем авто-исправление чаще, чем раз в 5 секунд
let logTailInterval = null;

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

const looksLikeError = (text) => {
    const lower = text.toLowerCase();
    return (lower.includes('error') && !lower.includes('0 errors'))
        || lower.includes('failed') || lower.includes('exception') || lower.includes('build failure');
};

export function runDevServer(targetProject, onErrorCallback) {
    if (currentProcess) {
        console.log('\n⚠️ Процесс уже запущен. Введите /stop для остановки.');
        return;
    }

    const { targetAbsolute } = getStatePaths(targetProject);
    const { runPath, isJava } = locateRunTarget(targetAbsolute);
    console.log(`\n🚀 Запускаю процесс в: ${runPath}`);

    const processOutput = (data) => {
        const output = data.toString();
        process.stdout.write(`[TARGET] ${output}`);
        if (looksLikeError(output)) {
            const now = Date.now();
            if (now - lastErrorAt > 5000) {
                lastErrorAt = now;
                onErrorCallback(output);
            }
        }
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
                    fs.createReadStream(latestLog, { start: lastSize, end: size }).on('data', processOutput);
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
    child.stdout.on('data', processOutput);
    child.stderr.on('data', processOutput);
    // Обнуляем только если это всё ещё ТЕКУЩИЙ процесс (после рестарта старый закрывается позже нового)
    child.on('close', () => { if (currentProcess === child) currentProcess = null; });
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
    } else if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', currentProcess.pid, '/f', '/t']);
    } else {
        currentProcess.kill();
    }
    currentProcess = null;
}
