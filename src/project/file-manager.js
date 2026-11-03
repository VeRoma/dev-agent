import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import { AGENT_ROOT } from '../config.js';
import { resolveInside, isSecretPath } from '@veroma/ai-core/safety';

// Always ignored, even if missing from .agentignore
const ALWAYS_IGNORED = ['.git', 'node_modules', '.dev-agent', '.meta-agent', '.agent_backup'];

function buildIgnoreFilter(agentRoot) {
    const ig = ignore();
    const ignorePath = path.join(agentRoot, '.agentignore');
    if (fs.existsSync(ignorePath)) ig.add(fs.readFileSync(ignorePath, 'utf-8'));
    ig.add(ALWAYS_IGNORED);
    return ig;
}

/**
 * All allowed project files: relative paths with forward slashes, sorted.
 * Secret files (.env*) are never listed; files ignored by the project .gitignore are skipped.
 */
export function listProjectFiles(targetAbsolute, { agentRoot = AGENT_ROOT } = {}) {
    const root = path.resolve(targetAbsolute);
    if (!fs.existsSync(root)) {
        console.error(`❌ Папка проекта не найдена: ${root}`);
        return [];
    }

    const ig = buildIgnoreFilter(agentRoot);
    const result = [];

    // The project's own .gitignore files (root and nested) apply too: build output such as target/ stays out of the map
    const gitignoreAt = (dir, base) => {
        const file = path.join(dir, '.gitignore');
        if (!fs.existsSync(file)) return null;
        try { return { base, ig: ignore().add(fs.readFileSync(file, 'utf-8')) }; } catch { return null; }
    };

    const walk = (dir, relative, gitRules) => {
        const own = gitignoreAt(dir, relative);
        const rules = own ? [...gitRules, own] : gitRules;

        for (const item of fs.readdirSync(dir)) {
            const itemRelative = relative ? `${relative}/${item}` : item;
            const fullPath = path.join(dir, item);

            let stat;
            try { stat = fs.statSync(fullPath); } catch { continue; }

            // Directories are checked with a trailing "/", otherwise rules like "dist/" do not match
            const probe = stat.isDirectory() ? `${itemRelative}/` : itemRelative;
            if (ig.ignores(probe)) continue;
            if (rules.some(r => r.ig.ignores(r.base ? probe.slice(r.base.length + 1) : probe))) continue;
            if (isSecretPath(itemRelative)) continue;

            if (stat.isDirectory()) walk(fullPath, itemRelative, rules);
            else if (stat.isFile()) result.push(itemRelative);
        }
    };

    walk(root, '', []);
    return result.sort();
}

/**
 * Reads files and builds one text context for the LLM.
 * Relative paths resolve from the TARGET project root; files outside the project and secrets are skipped.
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
