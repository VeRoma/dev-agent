import TelegramBot from 'node-telegram-bot-api';
import { execFile } from 'child_process';
import path from 'path';
// Same project rules as the agent (one implementation): ../repositories, plus "self" / 0 — the agent itself
import { listProjects, resolveProject } from '../src/project/projects.js';
import { SELF_PROJECT, SELF_BRANCH } from '../src/project/self-workspace.js';
import { classifyExternalTask, EXTERNAL_COMMANDS } from '../src/cli/external-task.js';

const agentDir = path.join(import.meta.dirname, '..');

// Secrets: the agent's src/config.js has already loaded ../.env; they are read ONLY from the environment
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MY_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);

// Fail fast: without valid secrets the bot does not start
if (!TOKEN || !process.env.TELEGRAM_CHAT_ID || !Number.isFinite(MY_CHAT_ID)) {
    console.error('❌ Ошибка запуска: не заданы TELEGRAM_BOT_TOKEN и/или TELEGRAM_CHAT_ID. Проверьте .env в корне проекта.');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// The active project is stored by NAME, not by number: if the list changes,
// a task never goes to someone else's project. The agent checks the name again at startup.
let activeProject = null;
let taskRunning = false;

const HELP =
    `Команды: /list — проекты, /p <номер, имя или self> — выбрать проект.\n` +
    `Агенту: текст задачи или ${EXTERNAL_COMMANDS.join(', ')}.\n` +
    `/self-diff работает и без выбранного проекта.`;

console.log('🤖 Dev-Bot запущен и слушает Telegram...');

function runAgent(chatId, project, text) {
    taskRunning = true;
    bot.sendMessage(chatId, `⏳ Принял (проект ${project}). Запускаю Агента...`);

    // No shell: the project and the task go through this process's environment only
    // (not a shared file a manual agent start could pick up). Works on any OS.
    execFile(process.execPath, ['agent.js'], {
        cwd: agentDir,
        env: { ...process.env, AUTO_PROJECT: project, DEV_TASK: text },
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
        taskRunning = false;
        let response = '';

        if (error) response += `❌ Ошибка:\n${error.message}\n\n`;
        if (stderr) response += `⚠️ System Info:\n${stderr}\n\n`;
        if (stdout) response += `✅ Лог Агента:\n${stdout}`;

        if (response.length > 4000) response = '...' + response.substring(response.length - 3900);

        bot.sendMessage(chatId, response || 'Агент отработал тихо.');
    });
}

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // SECURITY: strangers are turned away
    if (chatId !== MY_CHAT_ID) {
        bot.sendMessage(chatId, '⛔ Доступ к Агенту запрещен.');
        return;
    }

    const text = msg.text?.trim();
    if (!text) return;
    const lower = text.toLowerCase();

    if (lower === '/help' || lower === '/start') {
        bot.sendMessage(chatId, HELP);
        return;
    }

    if (lower === '/list' || lower === '/projects') {
        try {
            const mark = (name) => (name === activeProject ? '✅' : '  ');
            const lines = [
                `${mark(SELF_PROJECT)} [0] self — сам dev-agent (worktree, ветка ${SELF_BRANCH})`,
                ...listProjects().map((name, i) => `${mark(name)} [${i + 1}] ${name}`),
            ];
            bot.sendMessage(chatId,
                `📂 Доступные проекты:\n\n${lines.join('\n')}\n\nТекущий проект: ${activeProject ?? 'не выбран'}\nЧтобы сменить, отправь: /p <номер или имя>`);
        } catch (e) {
            bot.sendMessage(chatId, `❌ Ошибка чтения папки проектов: ${e.message}`);
        }
        return;
    }

    if (lower === '/p' || lower.startsWith('/p ')) {
        try {
            const selected = resolveProject(text.slice(2));
            if (!selected) {
                bot.sendMessage(chatId, '⚠️ Такого проекта нет. Пример: /p 3, /p имя-проекта, /p self. Список: /list');
            } else {
                activeProject = selected;
                const note = selected === SELF_PROJECT
                    ? `\nРежим самоулучшения: правки идут в worktree (ветка ${SELF_BRANCH}), рабочая копия агента не меняется. Проверить правки: /self-diff`
                    : '';
                bot.sendMessage(chatId, `🔄 Активный проект: ${selected}\nТеперь все задачи будут улетать в него!${note}`);
            }
        } catch (e) {
            bot.sendMessage(chatId, `❌ Ошибка чтения папки проектов: ${e.message}`);
        }
        return;
    }

    const kind = classifyExternalTask(text);
    if (kind === 'refused') {
        bot.sendMessage(chatId, `⚠️ Эта команда недоступна из Telegram.\n${HELP}`);
        return;
    }

    // /self-diff looks at the self worktree whatever project is active
    const project = lower.startsWith('/self-diff') ? (activeProject ?? SELF_PROJECT) : activeProject;
    if (!project) {
        bot.sendMessage(chatId, '⚠️ Сначала выберите проект: /list, затем /p <номер или имя>.');
        return;
    }
    if (taskRunning) {
        bot.sendMessage(chatId, '⏳ Предыдущая задача ещё выполняется. Дождитесь ответа.');
        return;
    }

    runAgent(chatId, project, text);
});
