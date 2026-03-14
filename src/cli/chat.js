import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { getProjectFiles, readFilesContent } from '../fs/file-manager.js';
import { initSession, appendToSession, getSession } from '../core/session.js';
import { askModel } from '../core/llm.js';
import { determineRelevantFiles } from '../core/routing.js';

const configPath = path.join(process.cwd(), 'agent.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

export function startCLI() {
    console.log(`\n🚀 Dev-Agent запущен!`);
    console.log(`🧠 Исполнитель: ${config.llm.executorModel}`);
    console.log(`📂 Рабочая директория: ${config.workspace.targetProject}\n`);
    
    // Инициализируем стартовую сессию
    initSession('Текущая разработка (General)');
    
    chatLoop();
}

function chatLoop() {
    rl.question('🧑 Твой вопрос (или "exit" для выхода): ', async (answer) => {
        const text = answer.trim();
        
        if (text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
            console.log('👋 Завершаю работу. До встречи!');
            rl.close();
            return;
        }

        if (!text) {
            chatLoop();
            return;
        }

        console.log('🤖 Агент собирает контекст...');
        
        // Записываем твой вопрос в историю сессии
        appendToSession('user', text);

        try {
            // 1. Диспетчер выбирает только нужные файлы!
            const relevantFiles = await determineRelevantFiles(text, config.workspace.targetProject);
            
            console.log(`📂 Выбрано файлов для анализа: ${relevantFiles.length}`);
            if (relevantFiles.length > 0) {
                relevantFiles.forEach(f => console.log(`   - ${path.basename(f)}`));
            }

            // 2. Читаем исходники ТОЛЬКО выбранных файлов
            const filesContext = readFilesContent(relevantFiles);

            // 3. Читаем память
            const sessionContext = getSession();

            // 4. Отправляем в Pro-модель
            const prompt = `
КОНТЕКСТ КОДА (Только релевантные файлы):
${filesContext || 'Файлы не требуются.'}

ТЕКУЩАЯ СЕССИЯ (Задача и диалог):
${sessionContext}

Ответь на последнее сообщение разработчика.
`;
            
            console.log('🤖 Исполнитель (Pro) пишет ответ...');
            const response = await askModel(prompt, false);

// ... дальше все остается как было (вывод ответа и запись в сессию)
        } catch (error) {
            console.error('\n❌ Ошибка в процессе обработки:', error.message);
        }

        // Ждем следующий вопрос
        chatLoop();
    });
}