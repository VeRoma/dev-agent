import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Before importing modules: stub keys (loadEnvFile does not override set variables), no VS Code
process.env.DEV_AGENT_NO_EDITOR = '1';
process.env.DEEPSEEK_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
process.env.CLAUDE_API_KEY = 'test-key';

const { config, setTargetProject } = await import('../src/config.js');
const { processAgentTask } = await import('../src/engine/task-runner.js');
const { initSession, getSession } = await import('../src/engine/session.js');
const { setConfirmHandler } = await import('../src/engine/io.js');
const { buildProjectMap } = await import('../src/project/project-map.js');
const { getStatePaths } = await import('../src/project/state-paths.js');
const { getUsage, formatUsage } = await import('../src/llm/usage.js');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

const TEST_LLM = {
    orchestratorModel: 'gemini-orchestrator',
    tiers: { local: 'qwen-test', fast: 'deepseek-test', pro: 'gemini-executor', arch: 'claude-test' },
    cloudFallbacks: [], // deterministic: no hidden fallback hops
};

function makeProject(files, llm = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-e2e-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t","scripts":{}}');
    setTargetProject(dir);
    for (const key of Object.keys(config.llm)) delete config.llm[key]; // the AI facade keeps a reference to this object
    Object.assign(config.llm, structuredClone(TEST_LLM), llm);
    buildProjectMap(dir);
    initSession('e2e');
    setConfirmHandler(async () => false);
    return dir;
}

/**
 * Mocks the network. orchestrator(n) and executor(n, prompt, provider) return the model's reply (text/object) or an Error.
 * The log records which provider the executor used and with which prompt.
 */
function mockNetwork({ orchestrator, executor }) {
    const log = { executor: [], orchestratorCalls: 0 };
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
    const fail = (error) => ({ ok: false, status: 500, text: async () => error.message });

    globalThis.fetch = async (url, opts) => {
        url = String(url);
        const body = JSON.parse(opts.body);

        if (url.includes('11434')) { // local translator: returns the text as is
            return ok({ response: body.prompt.split('\n').pop(), prompt_eval_count: 10, eval_count: 5 });
        }

        let provider, prompt;
        if (url.includes('generativelanguage')) {
            if (body.systemInstruction?.parts[0].text.includes('Task Orchestrator')) {
                const reply = orchestrator(++log.orchestratorCalls);
                return reply instanceof Error ? fail(reply) : ok({
                    candidates: [{ content: { parts: [{ text: reply }] } }],
                    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
                });
            }
            provider = 'gemini';
            prompt = body.contents[0].parts[0].text;
        } else if (url.includes('deepseek')) {
            provider = 'deepseek';
            prompt = body.messages.at(-1).content;
        } else if (url.includes('anthropic')) {
            provider = 'claude';
            prompt = body.messages.at(-1).content;
        } else {
            throw new Error(`unexpected request: ${url}`);
        }

        log.executor.push({ provider, prompt });
        const reply = executor(log.executor.length, prompt, provider);
        if (reply instanceof Error) return fail(reply);
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
        if (provider === 'gemini') return ok({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
        if (provider === 'claude') return ok({ content: [{ type: 'text', text }], usage: { input_tokens: 2000, output_tokens: 300 } });
        return ok({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 2000, completion_tokens: 300 } });
    };
    return log;
}

const decision = (obj = {}) => () => JSON.stringify({ files: [], delegateTo: 'ds', reason: 'test', subtaskPrompt: 'do it', ...obj });
const providers = (log) => log.executor.map(p => p.provider);
const brokenJsPatch = { mode: 'patch', message: 'сломанный патч', filesToUpdate: [{ path: 'src/a.js', content: 'export const = ;' }] };
const goodPatch = (content) => ({ mode: 'patch', message: 'Готово', filesToUpdate: [{ path: 'src/a.js', content }] });

test('e2e patch: junk paths dropped; executor gets task AND plan; placeholder rejected -> broken JSON retried -> valid patch; risky command denied', async () => {
    const dir = makeProject({ 'src/a.js': 'export const a = 1;\nexport function hello() { return "hi"; }\n' });
    const script = [
        { mode: 'patch', message: 'ленивый патч', filesToUpdate: [{ path: 'src/a.js', content: '// ... (остальной код остается без изменений) ...\n' }] },
        'Sure, here is the patch: {oops this is not json',
        { mode: 'patch', message: 'Добавил multiply', plan: ['1. добавляю функцию'],
          filesToUpdate: [{ path: 'src/a.js', content: 'export const a = 1;\nexport function hello() { return "hi"; }\nexport const multiply = (x, y) => x * y;\n' }],
          commandsToRun: ['rm -rf src', 'npm test', 'node --check src/a.js'] },
    ];
    const log = mockNetwork({
        orchestrator: decision({ files: ['src/a.js', '../../etc/passwd', 'ghost.js'], subtaskPrompt: 'ORCHESTRATOR PLAN: add multiply(x, y)' }),
        executor: (n) => script[n - 1],
    });

    await processAgentTask('add a multiply function to the module');

    const prompts = log.executor.map(p => p.prompt);
    assert.equal(prompts.length, 3, '1) placeholder patch  2) broken JSON  3) retry returns the valid patch');
    assert.ok(prompts[0].includes('export function hello()'), 'file content must reach the model');
    assert.ok(!prompts[0].includes('passwd'), 'orchestrator junk paths must be dropped');
    assert.ok(prompts[0].includes('add a multiply function to the module'), 'the original task reaches the executor');
    assert.ok(prompts[0].includes('ORCHESTRATOR PLAN'), 'the orchestrator plan reaches the executor');
    assert.ok(prompts[1].includes('NOTHING was written'), 'rejection reason must be fed back');
    assert.ok(prompts[2].includes('NOT valid JSON'), 'broken JSON triggers one retry with a hint');

    assert.ok(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8').includes('multiply'));
    const session = getSession();
    assert.ok(session.includes('[COMMAND DENIED]: rm -rf src'));
    assert.ok(fs.existsSync(path.join(dir, 'src/a.js')), 'rm -rf src must NOT have run');
    assert.ok(session.includes('[COMMAND EXECUTED]: node --check src/a.js'));
    assert.ok(!session.includes(': npm test'), 'tests run once, in the post-patch checks, not as a model command');
    assert.ok(session.includes('[PATCH APPLIED SUCCESSFULLY]'), 'missing ESLint/tests must not trigger self-healing');
    assert.ok(fs.readFileSync(getStatePaths(dir).mapFile, 'utf-8').includes('multiply'));
});

test('e2e escalation: two failures on the fast tier -> the third attempt goes to pro', async () => {
    const dir = makeProject({ 'src/a.js': 'export const a = 1;\n' });
    const log = mockNetwork({
        orchestrator: decision(),
        executor: (n, prompt, provider) => (provider === 'deepseek' ? brokenJsPatch : goodPatch('export const a = 2;\n')),
    });

    await processAgentTask('change a to 2');

    assert.deepEqual(providers(log), ['deepseek', 'deepseek', 'gemini']);
    assert.equal(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8'), 'export const a = 2;\n');
});

test('e2e escalation: a tier forced by a tag is never escalated', async () => {
    makeProject({ 'src/a.js': 'export const a = 1;\n' });
    const log = mockNetwork({ orchestrator: decision(), executor: () => brokenJsPatch });

    await processAgentTask('@ds change a to 2');

    assert.deepEqual([...new Set(providers(log))], ['deepseek']);
    assert.equal(log.executor.length, 4, 'first attempt + 3 healing attempts, all on the forced tier');
});

test('e2e tags: @claude overrides the orchestrator and the executor is kept when files are auto-loaded', async () => {
    makeProject({ 'f1.js': 'export const v1 = 1;\n', 'f2.js': 'export const v2 = 2;\n' });
    const log = mockNetwork({
        orchestrator: decision({ files: ['f1.js'] }),
        executor: (n) => (n === 1 ? { mode: 'chat', message: 'Нужен ещё @f2.js' } : { mode: 'chat', message: 'Готово' }),
    });

    await processAgentTask('@claude explain the code');

    assert.deepEqual(providers(log), ['claude', 'claude'], 'tag wins, and depth 1 stays on Claude');
    assert.ok(log.executor[1].prompt.includes('export const v2'), 'requested file is loaded');
    assert.ok(log.executor[1].prompt.includes('export const v1'), 'previously loaded files survive the recursion');
    assert.equal(log.orchestratorCalls, 1, 'the orchestrator is not called again on auto-loading');
});

test('e2e chat: commands of a reply without file changes are run, not dropped', async () => {
    makeProject({ 'src/a.js': 'export const a = 1;\n' });
    mockNetwork({
        orchestrator: decision({ files: ['src/a.js'] }),
        executor: () => ({ mode: 'chat', message: 'Проверяю синтаксис', commandsToRun: ['node --check src/a.js'] }),
    });

    await processAgentTask('check the module');

    assert.ok(getSession().includes('[COMMAND EXECUTED]: node --check src/a.js'));
});

test('e2e patch: git add/commit in a reply that also edits files commit the previous step, before the new edits', async () => {
    const dir = makeProject({ 'src/a.js': 'export const step = 1;\n' });
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
    git(['init', '-q']);
    git(['config', 'user.email', 't@example.com']); git(['config', 'user.name', 't']); git(['config', 'core.autocrlf', 'false']);
    git(['add', '-A']); git(['commit', '-qm', 'base']);
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'export const step = 2;\n'); // previous step: verified, not committed yet
    mockNetwork({
        orchestrator: decision({ files: ['src/a.js'] }),
        executor: () => ({
            mode: 'patch', message: 'Коммичу шаг 2 и делаю шаг 3',
            filesToUpdate: [{ path: 'src/a.js', edits: [{ search: 'step = 2', replace: 'step = 3' }] }],
            commandsToRun: ['git add src/a.js', 'git commit -m "step 2"'],
        }),
    });

    await processAgentTask('commit step 2 and do step 3');

    assert.equal(git(['show', 'HEAD:src/a.js']), 'export const step = 2;\n', 'the commit holds step 2 only');
    assert.equal(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8'), 'export const step = 3;\n', 'step 3 is applied after it');
});

test('e2e patch: when the commit of the previous step is declined, the new edits are not written either', async () => {
    const dir = makeProject({ 'src/a.js': 'export const step = 2;\n' }); // the confirm handler declines everything
    mockNetwork({
        orchestrator: decision({ files: ['src/a.js'] }),
        executor: () => ({
            mode: 'patch', message: 'Коммичу шаг 2 и делаю шаг 3',
            filesToUpdate: [{ path: 'src/a.js', edits: [{ search: 'step = 2', replace: 'step = 3' }] }],
            commandsToRun: ['git commit -m "step 2" -- src/a.js'],
        }),
    });

    await processAgentTask('commit step 2 and do step 3');

    assert.equal(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8'), 'export const step = 2;\n');
    assert.ok(getSession().includes('NONE of your file changes were written'));
});

test('e2e chat: automatic file loading is capped (no endless @-recursion)', async () => {
    const files = {};
    for (let i = 1; i <= 8; i++) files[`f${i}.js`] = `export const v${i} = ${i};\n`;
    makeProject(files);
    const log = mockNetwork({
        orchestrator: decision({ files: ['f1.js'] }),
        executor: (n) => ({ mode: 'chat', message: `Нужен ещё @f${n + 1}.js` }),
    });

    await processAgentTask('explain @f1.js');

    assert.equal(log.executor.length, 4, 'depth 0..3, then the limit stops the chain');
});

test('e2e outages: orchestrator down -> default tier; DeepSeek down -> escalation to the cloud pro tier; the local model never writes code', async () => {
    makeProject({ 'a.js': 'export const a = 1;\n' });
    const log = mockNetwork({
        orchestrator: () => new Error('Gemini orchestrator down'),
        executor: (n, prompt, provider) => (provider === 'deepseek' ? new Error('DeepSeek down') : { mode: 'chat', message: 'Ответ облачной модели' }),
    });

    await processAgentTask('explain @a.js');

    assert.ok(!providers(log).includes('ollama'));
    assert.equal(providers(log).at(-1), 'gemini', 'after repeated DeepSeek failures the task moves up a tier');
    assert.ok(getSession().includes('Ответ облачной модели'));
});

test('e2e /audit: a full audit is never given to the fast tier', async () => {
    makeProject({ 'a.js': 'export const a = 1;\n' });
    const log = mockNetwork({ orchestrator: decision({ tier: 'fast' }), executor: () => ({ mode: 'chat', message: 'Отчёт' }) });

    await processAgentTask('audit everything', 0, [], { forceFullAudit: true });

    assert.deepEqual(providers(log), ['gemini']);
});

test('e2e usage: every call of the task is recorded by role; the summary shows tokens and, with pricing, cost', async () => {
    makeProject({ 'src/a.js': 'export const a = 1;\n' });
    mockNetwork({
        orchestrator: decision(),
        executor: (n) => (n === 1 ? brokenJsPatch : goodPatch('export const a = 3;\n')),
    });

    await processAgentTask('change a to 3');

    const usage = getUsage();
    assert.deepEqual(usage.map(u => u.label), ['orchestrator', 'fast', 'fast fix']);
    assert.deepEqual(usage.map(u => u.inputTokens), [1000, 2000, 2000]);

    const summary = formatUsage(usage, {
        'gemini-orchestrator': { input: 1, output: 10 },
        'deepseek-test': { input: 0.5, output: 1 },
    });
    assert.match(summary, /orchestrator\s+gemini-orchestrator: 1 выз\., 1\.0k → 50/);
    // orchestrator (1000*1 + 50*10)/1e6 = 0.0015; deepseek (4000*0.5 + 600*1)/1e6 = 0.0026
    assert.match(summary, /Итого: 5\.0k → 650 ≈ \$0\.0041/);
    assert.ok(!/не для всех моделей/.test(summary));
    assert.match(formatUsage(usage, {}), /Итого: 5\.0k → 650$/, 'no pricing -> no cost, tokens only');
});
