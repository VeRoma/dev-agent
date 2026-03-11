import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Инициализируем API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Используем актуальную модель для программирования
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

// Путь к твоему WebGL проекту (поменяй на свой реальный путь)
const TARGET_PROJECT_PATH = '../'; 

// Функция: Читаем файлы из папки, чтобы создать "память"
function getProjectContext(directory) {
    let context = '';
    
    // Проверяем, существует ли папка
    if (!fs.existsSync(directory)) {
        console.log(`Папка ${directory} не найдена. Проверь путь.`);
        return context;
    }

    const files = fs.readdirSync(directory);

    files.forEach(file => {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);

        // Для начала читаем только файлы на верхнем уровне, игнорируя папки
        if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.jsx') || file.endsWith('.tsx'))) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            context += `\n--- Файл: ${file} ---\n${content}\n`;
        }
    });

    return context;
}

// Главная функция агента
async function askAgent(userQuestion) {
    console.log('Агент собирает контекст проекта...');
    const projectMemory = getProjectContext(TARGET_PROJECT_PATH);

    if (!projectMemory) {
        console.log('Контекст пуст. Агент ответит только на основе базовых знаний.');
    }

    // Формируем системный промпт + память + вопрос
    const prompt = `
    Ты — Senior WebGL разработчик и мой ИИ-ассистент.
    Вот актуальный код моего проекта:
    ${projectMemory}

    Ответь на следующий вопрос разработчика, опираясь строго на предоставленный код:
    Вопрос: ${userQuestion}
    `;

    console.log('Агент думает...\n');
    
    try {
        const result = await model.generateContent(prompt);
        console.log('================ ОТВЕТ АГЕНТА ================');
        console.log(result.response.text());
        console.log('==============================================');
    } catch (error) {
        console.error('Ошибка при обращении к API:', error);
    }
}

// Запускаем агента с тестовым вопросом
const question = "Проанализируй мой код. Какие компоненты у меня сейчас есть и как я могу добавить базовое освещение в сцену?";
askAgent(question);