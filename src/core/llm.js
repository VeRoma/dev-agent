import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Загружаем конфиг
const configPath = path.join(process.cwd(), 'agent.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Инициализируем API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Создаем инстансы моделей (Диспетчер и Исполнитель)
const executorModel = genAI.getGenerativeModel({ 
    model: config.llm.executorModel,
    systemInstruction: config.prompts.systemRole
});

const dispatcherModel = genAI.getGenerativeModel({ 
    model: config.llm.dispatcherModel 
    // Диспетчеру системная роль Senior'а не нужна, у него будут свои узкие задачи
});

/**
 * Отправляет запрос к LLM
 * @param {string} prompt - Текст запроса (включая контекст файлов и сессии)
 * @param {boolean} useDispatcher - Если true, используется быстрая Flash-модель
 * @returns {Promise<string>} Ответ модели
 */
export async function askModel(prompt, useDispatcher = false) {
    const model = useDispatcher ? dispatcherModel : executorModel;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('\n❌ Ошибка API Gemini:', error.message);
        throw error;
    }
}