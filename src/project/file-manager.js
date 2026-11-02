import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import { AGENT_ROOT } from '../config.js';
import { resolveInside, isSecretPath } from '@veroma/ai-core/safety';

// Игнорируется всегда, даже если забыли указать в .agentignore
const ALWAYS_IGNORED = ['.git', 'node_modules', '.dev-agent', '.meta-agent', '.agent_backup'];

function buildIgnoreFilter(agentRoot) {
    const ig = ignore();
    const ignorePath = path.join(agentRoot, '.agentignore');
    if (fs.existsSync(ignorePath)) ig.add(fs.readFileSync(ignorePath, 'utf-8'));
    ig.add(ALWAYS_IGNORED);
    return ig;
}

/**
 * Все разрешённые файлы проекта: относительные пути с прямыми слэшами, отсортированные.
 * Файлы с секретами (.env*) не попадают в список никогда.
 */
export function listProjectFiles(targetAbsolute, { agentRoot = AGENT_ROOT } = {}) {
    const root = path.resolve(targetAbsolute);
    if (!fs.existsSync(root)) {
        console.error(`❌ Папка проекта не найдена: ${root}`);
        return [];
    }

    const ig = buildIgnoreFilter(agentRoot);
    const result = [];

    const walk = (dir, relative = '') => {
        for (const item of fs.readdirSync(dir)) {
            const itemRelative = relative ? `${relative}/${item}` : item;
            const fullPath = path.join(dir, item);

            let stat;
            try { stat = fs.statSync(fullPath); } catch { continue; }

            // Для папок проверяем путь с "/" на конце, иначе правила вида "dist/" не срабатывают
            if (ig.ignores(stat.isDirectory() ? `${itemRelative}/` : itemRelative)) continue;
            if (isSecretPath(itemRelative)) continue;

            if (stat.isDirectory()) walk(fullPath, itemRelative);
            else if (stat.isFile()) result.push(itemRelative);
        }
    };

    walk(root);
    return result.sort();
}

/**
 * Читает файлы и собирает единый текстовый контекст для LLM.
 * Относительные пути разрешаются от корня ЦЕЛЕВОГО проекта; файлы вне проекта и секреты пропускаются.
 */
export function readFilesContent(filePaths, targetAbsolute) {
    const root = path.resolve(targetAbsolute);
    const seen = new Set();
    let context = '';

    for (const filePath of filePaths) {
        const candidate = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

        let absolutePath;
        try {
            absolutePath = resolveInside(root, path.relative(root, candidate));
        } catch {
            console.log(`⚠️ Пропускаю файл вне проекта: ${filePath}`);
            continue;
        }

        if (seen.has(absolutePath)) continue;
        seen.add(absolutePath);

        const cleanPath = path.relative(root, absolutePath).replace(/\\/g, '/');

        if (isSecretPath(cleanPath)) {
            console.log(`🔒 Файл с секретами не отправляется в LLM: ${cleanPath}`);
            continue;
        }
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;

        context += `\n--- Файл: ${cleanPath} ---\n${fs.readFileSync(absolutePath, 'utf-8')}\n`;
    }
    return context;
}
