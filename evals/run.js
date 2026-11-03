// Eval runner: every task on a fresh fixture in the OS temp dir (never ../repositories),
// the agent in a child process, then hidden tests + checks, metrics, and a comparison with the previous run.
// Usage: npm run eval [-- <taskId>...] [--keep] [--timeout=<sec>]
// Costs real tokens: every task calls the configured models.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { TASKS } from './tasks.js';
import { createFixture, grade, agentOutcome, metrics } from './harness.js';
import { config } from '../src/config.js';

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(EVALS_DIR, 'results');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const timeoutSec = Number(args.find(a => a.startsWith('--timeout='))?.split('=')[1] ?? 600);
const ids = args.filter(a => !a.startsWith('--'));
const unknown = ids.filter(id => !TASKS.some(t => t.id === id));
if (unknown.length) {
    console.error(`Неизвестные задачи: ${unknown.join(', ')}. Есть: ${TASKS.map(t => t.id).join(', ')}`);
    process.exit(2);
}
const selected = ids.length ? TASKS.filter(t => ids.includes(t.id)) : TASKS;

function runAgent(task, dir, logFile, resultFile) {
    return new Promise((resolve) => {
        const log = fs.openSync(logFile, 'w');
        const child = spawn(process.execPath, [path.join(EVALS_DIR, 'agent-task.js'), task.id, dir, resultFile], {
            cwd: path.dirname(EVALS_DIR),
            stdio: ['ignore', log, log],
            env: { ...process.env, DEV_AGENT_NO_EDITOR: '1' },
        });
        const timer = setTimeout(() => {
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t']);
            else child.kill('SIGKILL');
        }, timeoutSec * 1000);
        child.on('close', (code) => {
            clearTimeout(timer);
            fs.closeSync(log);
            resolve(code);
        });
    });
}

async function runTask(task, runDir) {
    const dir = createFixture(task);
    const logFile = path.join(runDir, `${task.id}.log`);
    const resultFile = `${dir}.result.json`;
    process.stdout.write(`▶ ${task.id} — ${task.title}... `);

    const code = await runAgent(task, dir, logFile, resultFile);
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf-8')) : null;
    fs.rmSync(resultFile, { force: true });

    const checks = result
        ? await grade(task, dir, result.session)
        : [{ ok: false, msg: `агент не завершился (код ${code}; таймаут ${timeoutSec} с?) — см. лог` }];
    if (result?.error) checks.push({ ok: false, msg: `ошибка задачи: ${result.error}` });

    const pass = checks.every(c => c.ok);
    const seconds = Math.round((result?.ms ?? 0) / 1000);
    console.log(`${pass ? '✅' : '❌'} ${seconds} с`);
    for (const c of checks.filter(c => !c.ok)) console.log(`     ✖ ${c.msg}`);

    if (keep) console.log(`     📁 ${dir}`);
    else fs.rmSync(dir, { recursive: true, force: true });

    return {
        id: task.id, pass, checks, outcome: agentOutcome(result?.session), seconds,
        ...metrics(result?.usage ?? [], config.llm.pricing), log: path.relative(EVALS_DIR, logFile),
    };
}

const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const money = (r) => (r.cost > 0 ? `$${r.cost.toFixed(4)}${r.priced ? '' : '+'}` : '—');

function previousRun() {
    if (!fs.existsSync(RESULTS_DIR)) return null;
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json')).sort();
    return files.length ? JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files.at(-1)), 'utf-8')) : null;
}

function printSummary(results, previous) {
    console.log('\n📊 Итог (испол. — вызовы исполнителя, испр. — из них исправления; «+» у цены — не все модели с ценой):');
    console.log(`   ${'задача'.padEnd(22)} итог   ${'агент'.padEnd(14)} испол. испр.  ${'уровни'.padEnd(13)} ${'вх→вых'.padStart(13)}  ${'цена'.padStart(9)}  время`);
    for (const r of results) {
        const prev = previous?.results.find(p => p.id === r.id);
        const delta = prev && prev.pass !== r.pass ? (r.pass ? '↑' : '↓') : ' ';
        console.log(`   ${r.id.padEnd(22)} ${r.pass ? '✅' : '❌'}${delta}   ${r.outcome.padEnd(14)} ${String(r.executorCalls).padStart(6)} ${String(r.fixes).padStart(5)}  ${r.tiers.join('→').padEnd(13)} ${`${kilo(r.inputTokens)}→${kilo(r.outputTokens)}`.padStart(13)}  ${money(r).padStart(9)}  ${String(r.seconds).padStart(4)} с`);
    }
    const passed = results.filter(r => r.pass).length;
    const total = (key) => results.reduce((s, r) => s + r[key], 0);
    console.log(`\n   Пройдено: ${passed}/${results.length} · токены ${kilo(total('inputTokens'))}→${kilo(total('outputTokens'))} · ≈ $${total('cost').toFixed(4)}${results.every(r => r.priced) ? '' : '+'} · ${total('seconds')} с`);
    if (previous) {
        const same = previous.results.filter(p => results.some(r => r.id === p.id));
        const prevTokens = same.reduce((s, p) => s + p.inputTokens + p.outputTokens, 0);
        console.log(`   Прошлый прогон (${previous.startedAt}), те же задачи: ${same.filter(p => p.pass).length}/${same.length} · токены ${kilo(prevTokens)}`);
    }
}

const startedAt = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(RESULTS_DIR, startedAt);
fs.mkdirSync(runDir, { recursive: true });
const previous = previousRun();

console.log(`🧪 Eval: ${selected.length} задач(и); модели из agent.config.json; логи: ${path.relative(process.cwd(), runDir)}`);
const results = [];
for (const task of selected) results.push(await runTask(task, runDir));

printSummary(results, previous);
fs.writeFileSync(path.join(RESULTS_DIR, `${startedAt}.json`), JSON.stringify({
    startedAt, orchestrator: config.llm.orchestratorModel, tiers: config.llm.tiers, results,
}, null, 2));
process.exit(results.every(r => r.pass) ? 0 : 1);
