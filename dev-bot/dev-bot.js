import TelegramBot from 'node-telegram-bot-api';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const agentDir = path.join(import.meta.dirname, '..');
// Те же правила, что в src/project/projects.js: папка ../repositories, без точечных папок и самого агента
const projectsDir = path.join(agentDir, '..', 'repositories');

// Загружаем секреты из ../.env (без новых зависимостей, Node >= 20.12)
try {
    process.loadEnvFile(path.join(agentDir, '.env'));
} catch (e) {
    console.error(`❌ Не удалось загрузить .env: ${e.message}`);
}

// Секреты читаются ТОЛЬКО из переменных окружения (в коде не хранятся)
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MY_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);

// Fail-fast: без валидных секретов бот не стартует
if (!TOKEN || !process.env.TELEGRAM_CHAT_ID || !Number.isFinite(MY_CHAT_ID)) {
    console.error('❌ Ошибка запуска: не заданы TELEGRAM_BOT_TOKEN и/или TELEGRAM_CHAT_ID. Проверьте .env в корне проекта.');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Активный проект хранится ИМЕНЕМ, а не номером: если список проектов изменится,
// задача не улетит в чужой проект. Агент дополнительно проверяет имя при запуске.
let activeProject = null;
let taskRunning = false;

function listProjects() {
    const agentFolder = path.basename(agentDir);
    return fs.readdirSync(projectsDir)
        .filter((name) => {
            if (name.startsWith('.') || name === agentFolder) return false;
            try { return fs.statSync(path.join(projectsDir, name)).isDirectory(); } catch { return false; }
        })
        .sort((a, b) => a.localeCompare(b));
}

function resolveProject(selector, projects) {
    const value = String(selector).trim();
    if (/^\d+$/.test(value)) return projects[Number(value) - 1] ?? null;
    return projects.includes(value) ? value : null;
}

console.log('🤖 Dev-Bot запущен и слушает Telegram...');

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // СЕКЬЮРИТИ: Отшиваем всех чужаков
    if (chatId !== MY_CHAT_ID) {
        bot.sendMessage(chatId, '⛔ Доступ к Агенту запрещен.');
        return;
    }

    const text = msg.text;
    if (!text) return;
    const lower = text.toLowerCase();

    // === КОМАНДА: ПОКАЗАТЬ СПИСОК ПРОЕКТОВ ===
    if (lower === '/list' || lower === '/projects') {
        try {
            const projects = listProjects();
            const lines = projects.map((name, i) => `${name === activeProject ? '✅' : '  '} [${i + 1}] ${name}`);
            bot.sendMessage(chatId,
                `📂 Доступные проекты:\n\n${lines.join('\n')}\n\nТекущий проект: ${activeProject ?? 'не выбран'}\nЧтобы сменить, отправь: /p <номер или имя>`);
        } catch (e) {
            bot.sendMessage(chatId, `❌ Ошибка чтения папки проектов: ${e.message}`);
        }
        return;
    }

    // === КОМАНДА: СМЕНИТЬ ПРОЕКТ ===
    if (lower.startsWith('/p ')) {
        try {
            const selected = resolveProject(text.slice(3), listProjects());
            if (!selected) {
                bot.sendMessage(chatId, '⚠️ Такого проекта нет. Пример: /p 3 или /p имя-проекта. Список: /list');
            } else {
                activeProject = selected;
                bot.sendMessage(chatId, `🔄 Активный проект: ${selected}\nТеперь все задачи будут улетать в него!`);
            }
        } catch (e) {
            bot.sendMessage(chatId, `❌ Ошибка чтения папки проектов: ${e.message}`);
        }
        return;
    }

    // === СТАНДАРТНОЕ ТЗ ДЛЯ АГЕНТА ===
    if (!activeProject) {
        bot.sendMessage(chatId, '⚠️ Сначала выберите проект: /list, затем /p <номер или имя>.');
        return;
    }
    if (taskRunning) {
        bot.sendMessage(chatId, '⏳ Предыдущая задача ещё выполняется. Дождитесь ответа.');
        return;
    }

    taskRunning = true;
    bot.sendMessage(chatId, `⏳ Принял задачу (проект ${activeProject}). Запускаю Агента...`);
    fs.writeFileSync(path.join(agentDir, 'agent_task.txt'), text);

    // Без shell и без PowerShell: проект передаётся через окружение, работает на любой ОС
    execFile(process.execPath, ['agent.js'], {
        cwd: agentDir,
        env: { ...process.env, AUTO_PROJECT: activeProject },
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
});
