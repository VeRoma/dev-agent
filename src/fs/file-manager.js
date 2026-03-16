import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

// Функция для загрузки и парсинга .agentignore
function getIgnoreFilter(agentRootDir) {
    const ig = ignore();
    const ignorePath = path.join(agentRootDir, '.agentignore');
    
    if (fs.existsSync(ignorePath)) {
        const ignoreContent = fs.readFileSync(ignorePath, 'utf-8');
        ig.add(ignoreContent);
    }
    
    // Хардкод защиты: всегда игнорируем эти папки, даже если их забыли указать
    ig.add(['.git', 'node_modules', '.agent_backup']);
    
    return ig;
}

/**
 * Рекурсивно собирает все разрешенные файлы из целевой директории
 * @param {string} targetPath - Путь к проекту (например, '../vrrgl')
 * @param {string} agentRootDir - Корневая папка самого агента (где лежит .agentignore)
 * @returns {Array<string>} Массив абсолютных путей к файлам
 */
export function getProjectFiles(targetPath, agentRootDir = process.cwd()) {
    const absoluteTargetPath = path.resolve(agentRootDir, targetPath);
    const ig = getIgnoreFilter(agentRootDir);
    const resultFiles = [];

    // Если целевой папки нет — прерываемся
    if (!fs.existsSync(absoluteTargetPath)) {
        console.error(`❌ Ошибка: Папка проекта ${absoluteTargetPath} не найдена.`);
        return resultFiles;
    }

    // Внутренняя функция для рекурсивного обхода
    function walk(currentDir, relativeToTarget = '') {
        const items = fs.readdirSync(currentDir);
        
        for (const item of items) {
            // Формируем путь относительного целевого проекта (для проверки в ignore)
            const itemRelativePath = relativeToTarget ? path.join(relativeToTarget, item) : item;
            
            // Если правило из .agentignore запрещает этот путь — пропускаем
            if (ig.ignores(itemRelativePath)) {
                continue;
            }

            const fullPath = path.join(currentDir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath, itemRelativePath); // Идем вглубь
            } else if (stat.isFile()) {
                resultFiles.push(fullPath); // Сохраняем файл
            }
        }
    }

    walk(absoluteTargetPath);
    return resultFiles;
}

/**
 * Читает содержимое переданных файлов и формирует единый текстовый контекст
 * @param {Array<string>} filePaths - Массив путей к файлам
 * @param {string} targetAbsolute - Абсолютный путь к корню проекта (чтобы вычислить относительные пути)
 * @returns {string} Текст с содержимым всех файлов
 */
export function readFilesContent(filePaths, targetAbsolute) {
    let context = '';
    for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            // Вычисляем путь относительно корня проекта (например: app/components/GlobeModel.tsx)
            const relativePath = targetAbsolute ? path.relative(targetAbsolute, filePath) : path.basename(filePath);
            
            // Заменяем обратные слэши Windows на прямые для единообразия в JSON
            const cleanPath = relativePath.replace(/\\/g, '/');
            
            context += `\n--- Файл: ${cleanPath} ---\n${content}\n`;
        }
    }
    return context;
}