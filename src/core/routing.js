import { askModel } from './llm.js';
import { getProjectFiles } from '../fs/file-manager.js';

/**
 * Запрашивает у диспетчера список релевантных файлов для задачи
 */
export async function determineRelevantFiles(userQuery, targetPath) {
    const allFiles = getProjectFiles(targetPath);
    
    const prompt = `
Ты — ИИ-маршрутизатор (Диспетчер).
Твоя задача — проанализировать запрос пользователя и выбрать из списка файлов проекта ТОЛЬКО те, которые необходимы для решения задачи.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
"${userQuery}"

ДОСТУПНЫЕ ФАЙЛЫ ПРОЕКТА:
${allFiles.map(f => `- ${f}`).join('\n')}

ВЕРНИ ТОЛЬКО ВАЛИДНЫЙ JSON-МАССИВ ПУТЕЙ. 
Не пиши никакого текста, никаких пояснений, не используй markdown-разметку (без \`\`\`json). 
Пример ответа: ["path/to/file1.tsx", "path/to/file2.ts"]
Если запрос общий и не требует файлов, верни [].
`;

    try {
        console.log('⚡ Диспетчер (Flash) определяет нужные файлы...');
        // true — используем быструю Flash-модель
        const response = await askModel(prompt, true); 
        
        // Очищаем ответ от возможного маркдауна, если модель все же его добавит
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        const selectedFiles = JSON.parse(cleanJson);
        
        return selectedFiles;
    } catch (error) {
        console.error('❌ Ошибка диспетчера (возвращаю все файлы):', error.message);
        // Фолбэк: если что-то пошло не так, отдаем все файлы, чтобы не прерывать работу
        return allFiles; 
    }
}