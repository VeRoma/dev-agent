import fs from 'fs';
import path from 'path';
import { getProjectFiles } from '../fs/file-manager.js';
import { askModel } from './llm.js';
import { getSession } from './session.js'; // <-- Добавили доступ к памяти

/**
 * Запрашивает у диспетчера список релевантных файлов для задачи
 */
export async function determineRelevantFiles(userQuery, targetPath) {
    console.log('⚡ Диспетчер (Flash) определяет нужные файлы...');
    const allFiles = getProjectFiles(targetPath);
    
    // 1. Собираем метаданные файлов для умной маршрутизации
    let metaContext = "AVAILABLE FILES AND THEIR METADATA:\n";

    for (const file of allFiles) {
        const absoluteFilePath = path.resolve(process.cwd(), targetPath, file);
        const ext = path.extname(absoluteFilePath);
        const baseName = path.basename(absoluteFilePath, ext);
        const dirName = path.dirname(absoluteFilePath);
        const metaPath = path.join(dirName, `${baseName}.meta.json`);

        if (fs.existsSync(metaPath)) {
            try {
                const metaData = fs.readFileSync(metaPath, 'utf-8');
                metaContext += `\nFile: ${file}\nMetadata: ${metaData}\n`;
            } catch (e) {}
        } else {
            metaContext += `\nFile: ${file} (No metadata available)\n`;
        }
    }

    // 2. Достаем историю текущей сессии
    const sessionContext = getSession();

    // 3. Строгий англоязычный промпт для Диспетчера
    const prompt = `
You are a smart file router for a codebase.
Based on the USER PROMPT and the CURRENT CHAT SESSION, identify which files need to be analyzed or modified.

${metaContext}

CURRENT CHAT SESSION (Context for the request):
${sessionContext || "No previous context."}

USER PROMPT:
${userQuery}

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON array of strings representing the exact file paths as they appear in the "File:" lines above.
2. Do not use markdown wrappers like \`\`\`json.
3. If no files are needed, return an empty array [].
`;

    try {
        const response = await askModel(prompt, true); // true — используем Flash-модель
        
        // Очищаем ответ от возможного маркдауна
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        const selectedFiles = JSON.parse(cleanJson);
        
        if (Array.isArray(selectedFiles)) {
            return selectedFiles;
        }
        return [];
    } catch (error) {
        console.error('❌ Ошибка диспетчера:', error.message);
        // Возвращаем пустой массив при ошибке, чтобы не переполнять контекст Pro-модели
        return []; 
    }
}