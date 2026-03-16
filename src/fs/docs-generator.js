import fs from 'fs';
import path from 'path';
import { askModel } from '../core/llm.js';
import { getProjectFiles } from './file-manager.js';

export async function generateDocumentation(targetPath, sessionContext) {
    if (!sessionContext || sessionContext.trim() === '') {
        console.log('⚠️ Session is empty, nothing to save.');
        return;
    }

    // ПОЛНОСТЬЮ АНГЛОЯЗЫЧНЫЙ ПРОМПТ
    const prompt = `
You are a technical writer and senior developer. Analyze the raw log of a working session between a developer and an AI.
Extract ONLY the final, successful decisions, solutions, and code modifications made to the project.
Completely ignore intermediate errors, non-working code drafts, and casual conversation.

Format the output as a concise, technical summary in a Markdown list (use bullet points, no top-level headers).

CRITICAL INSTRUCTION: Write the final summary STRICTLY IN ENGLISH, following Conventional Commits style where possible (e.g., feat, fix, refactor).

RAW SESSION LOG:
${sessionContext}
`;

    console.log('🤖 Analyzing session and generating documentation (Flash)...');
    
    try {
        // Используем быструю модель (true) для суммаризации текста
        const summary = await askModel(prompt, true);
        
        const historyFilePath = path.join(process.cwd(), targetPath, 'HISTORY.md');
        
        // Формируем красивый блок с датой (в формате YYYY-MM-DD)
        const date = new Date().toISOString().split('T')[0];
        const historyEntry = `\n### [${date}]\n${summary}\n`;

        // Дописываем в конец HISTORY.md (или создаем файл, если его нет)
        fs.appendFileSync(historyFilePath, historyEntry, 'utf-8');
        
        console.log('✅ Final solution successfully written to HISTORY.md!');
    } catch (error) {
        console.error('❌ Error generating documentation:', error.message);
    }
}

export async function generateIndexes(targetPath) {
    console.log('\n🔍 Запускаю авто-индексатор (Flash)...');
    
    // Получаем все разрешенные файлы проекта
    const allFiles = getProjectFiles(targetPath);
    
    // Оставляем только исходный код (компоненты, хуки, утилиты)
    const codeFiles = allFiles.filter(f => /\.(tsx|ts|jsx|js)$/.test(f));

    let processed = 0;
    let skipped = 0;

    for (const filePath of codeFiles) {
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        const dirName = path.dirname(filePath);
        
        // Формируем путь к файлу метаданных
        const metaPath = path.join(dirName, `${baseName}.meta.json`);

        // Если мета-файл уже существует, пропускаем
        if (fs.existsSync(metaPath)) {
            skipped++;
            continue;
        }

        console.log(`⏳ Читаю код: ${baseName}${ext} ...`);
        const content = fs.readFileSync(filePath, 'utf-8');

        // ЖЕСТКИЙ АНГЛОЯЗЫЧНЫЙ ПРОМПТ ДЛЯ JSON
        const prompt = `
You are a senior software architect. Analyze the following code file and generate a JSON metadata index for it.
CRITICAL INSTRUCTIONS:
1. Your entire response must be ONLY valid JSON.
2. Do not use markdown wrappers like \`\`\`json.
3. The content of "description" and "keywords" MUST be strictly in English.

Expected JSON format:
{
  "module": "${baseName}",
  "description": "Short technical description of what this module does.",
  "keywords": ["keyword1", "keyword2", "react", "state"],
  "interfaces": {
    "inputs": ["propName1"],
    "exports": ["${baseName}"]
  },
  "dependencies": ["./dependency1", "react"]
}

CODE TO ANALYZE:
${content}
`;

        try {
            // Вызываем быструю Flash-модель (true)
            const response = await askModel(prompt, true);
            
            // Зачищаем от случайного маркдауна
            const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            
            // Парсим
            const parsed = JSON.parse(cleanJson);
            
            // Сохраняем на диск
            fs.writeFileSync(metaPath, JSON.stringify(parsed, null, 2), 'utf-8');
            console.log(`✅ Создан индекс: ${baseName}.meta.json`);
            processed++;
            
            // Пауза 2 секунды, чтобы Google API не заблокировал за спам запросами
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.error(`❌ Ошибка ИИ при разборе ${baseName}${ext} (Пропускаю):`, error.message);
        }
    }

    console.log(`\n🎉 Индексация завершена!`);
    console.log(`   Создано новых: ${processed}`);
    console.log(`   Пропущено (уже были): ${skipped}\n`);
}