import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DEV_AGENT_NO_EDITOR = '1';
process.env.DEEPSEEK_API_KEY = 'test-key';
delete process.env.CLAUDE_API_KEY;

const { config, setTargetProject } = await import('../src/config.js');
const { processAgentTask } = await import('../src/engine/task-runner.js');
const { initSession, getSession } = await import('../src/engine/session.js');
const { setConfirmHandler } = await import('../src/engine/io.js');
const { buildProjectMap } = await import('../src/project/project-map.js');
const { getStatePaths } = await import('../src/project/state-paths.js');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

function makeProject(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-e2e-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t","scripts":{}}');
    setTargetProject(dir);
    Object.assign(config.llm, {
        dispatcherModel: 'qwen2.5-coder:7b-instruct', executorModel: 'deepseek-flash',
        cloudFallbacks: ['claude-sonnet-5-5'], fallbackModel: 'qwen2.5-coder:3b-instruct',
    });
    buildProjectMap(dir);
    initSession('e2e');
    setConfirmHandler(async () => false);
    return dir;
}

/** Подменяет сеть: Ollama отвечает диспетчером/переводчиком, DeepSeek — по сценарию. */
function mockNetwork({ dispatch = '[]', executor }) {
    const log = { executorPrompts: [], urls: [] };
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        log.urls.push(String(url));
        const json = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
        if (String(url).includes('11434')) {
            if (body.prompt.includes('smart file router')) return json({ response: dispatch });
            if (body.prompt.startsWith('Translate')) return json({ response: body.prompt.split('\n\n').pop() });
            log.executorPrompts.push({ via: 'ollama', prompt: body.prompt });
            return json({ response: executor(log.executorPrompts.length, body.prompt, 'ollama') });
        }
        log.executorPrompts.push({ via: 'deepseek', prompt: body.messages.at(-1).content });
        const reply = executor(log.executorPrompts.length, body.messages.at(-1).content, 'deepseek');
        if (reply instanceof Error) return { ok: false, status: 500, text: async () => reply.message };
        return json({ choices: [{ message: { content: reply } }] });
    };
    return log;
}

test('e2e patch: placeholder rejected -> broken JSON retried -> valid patch applied; risky command denied; env problems are warnings', async () => {
    const dir = makeProject({ 'src/a.js': 'export const a = 1;\nexport function hello() { return "hi"; }\n' });
    const script = [
        { mode: 'patch', message: 'ленивый патч', filesToUpdate: [{ path: 'src/a.js', content: '// ... (остальной код остается без изменений) ...\n' }] },
        'Sure, here is the patch: {oops this is not json',
        { mode: 'patch', message: 'Добавил multiply', plan: ['1. добавляю функцию'],
          filesToUpdate: [{ path: 'src/a.js', content: 'export const a = 1;\nexport function hello() { return "hi"; }\nexport const multiply = (x, y) => x * y;\n' }],
          commandsToRun: ['rm -rf src', 'node --check src/a.js'] },
    ];
    const log = mockNetwork({
        dispatch: '["src/a.js", "../../etc/passwd", "ghost.js"]',
        executor: (n) => (typeof script[n - 1] === 'string' ? script[n - 1] : JSON.stringify(script[n - 1])),
    });

    await processAgentTask('@a.js добавь функцию multiply');

    const prompts = log.executorPrompts.map(p => p.prompt);
    assert.equal(prompts.length, 3, '1) placeholder patch  2) broken JSON  3) automatic retry returns the valid patch');
    assert.ok(prompts[0].includes('export function hello()'), 'file content must reach the model');
    assert.ok(!prompts[0].includes('passwd'), 'dispatcher junk paths must be dropped');
    assert.ok(prompts[1].includes('NOTHING was written'), 'rejection reason must be fed back');
    assert.ok(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8').includes('multiply'));
    assert.ok(fs.existsSync(path.join(dir, 'src/a.js')), 'rm -rf src must NOT have run');
    const session = getSession();
    assert.ok(session.includes('[COMMAND DENIED]: rm -rf src'));
    assert.ok(session.includes('[COMMAND EXECUTED]: node --check src/a.js'));
    assert.ok(session.includes('[PATCH APPLIED SUCCESSFULLY]'), 'missing ESLint/tests must not trigger self-healing');
    assert.ok(fs.readFileSync(getStatePaths(dir).mapFile, 'utf-8').includes('multiply'));
});

test('e2e chat: automatic file loading is capped (no endless @-recursion)', async () => {
    const files = {};
    for (let i = 1; i <= 8; i++) files[`f${i}.js`] = `export const v${i} = ${i};\n`;
    makeProject(files);
    const log = mockNetwork({ dispatch: '["f1.js"]',
        executor: (n) => JSON.stringify({ mode: 'chat', message: `Нужен ещё @f${n + 1}.js` }) });

    await processAgentTask('объясни @f1.js');

    assert.equal(log.executorPrompts.length, 4, 'depth 0..3, then the limit stops the chain');
});

test('e2e fallback: DeepSeek fails -> Claude (no key) fails -> task fails honestly (local model never writes code)', async () => {
    makeProject({ 'a.js': 'export const a = 1;\n' });
    const log = mockNetwork({ dispatch: '[]',
        executor: (n, prompt, via) => via === 'deepseek' ? new Error('DeepSeek down') : JSON.stringify({ mode: 'chat', message: 'Ответ локальной модели' }) });

    await processAgentTask('привет');

    const providers = log.executorPrompts.map(p => p.via);
    // The executor chain must stay in the cloud: the local ollama fallback is filtered out of the
    // code-generation chain, so 'ollama' must NEVER appear here. When the cloud models fail, the
    // executor is retried (the mock labels every non-Ollama HTTP call as 'deepseek'), so several
    // 'deepseek' entries are expected, but never a local provider.
    assert.ok(providers.length >= 1, 'the cloud executor must be attempted at least once');
    assert.ok(!providers.includes('ollama'), 'the local ollama model must never be used for code generation');
    assert.deepEqual([...new Set(providers)], ['deepseek'], 'only the cloud provider may generate code');
    assert.ok(!getSession().includes('Ответ локальной модели'));
});
