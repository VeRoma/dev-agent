import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getStatePaths } from './state-paths.js';
import { listProjectFiles } from './file-manager.js';

// Карта проекта: один файл вместо сотен .meta.json рядом с исходниками.
// Лежит в <проект>/.dev-agent/PROJECT_MAP.md и не засоряет репозиторий.

const MAX_ANALYZE_BYTES = 512 * 1024;
const JS_FAMILY = /\.(mjs|cjs|jsx?|tsx?)$/i;
const INDEXABLE = /\.(mjs|cjs|jsx?|tsx?|vue|svelte|java|kt|py|go|rs|cs|php|rb|sql|ps1|sh|json|md|ya?ml|toml|html|css|scss|gradle|xml|properties)$/i;

// JSDoc в карте нужен диспетчеру на английском: русские описания отбрасываем
function cleanComment(raw) {
    if (!raw) return '';
    const cleaned = raw.split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(line => line && !line.startsWith('@'))
        .join(' - ');
    return /[а-яА-ЯЁё]/.test(cleaned) ? '' : cleaned;
}

function analyzeJs(content) {
    const nodes = [];
    const declaration = /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(default\s+)?(async\s+)?(function\*?|class|abstract\s+class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
    let m;
    while ((m = declaration.exec(content)) !== null) {
        const [, doc, isDefault, isAsync, kind, name] = m;
        const description = cleanComment(doc);
        nodes.push(`- **${name}** (${isDefault ? 'default ' : ''}${isAsync ? 'async ' : ''}${kind.replace(/\s+/g, ' ')})${description ? `: ${description}` : ''}`);
    }

    const list = /export\s*\{([^}]*)\}/g;
    while ((m = list.exec(content)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/i).pop();
            if (name) nodes.push(`- **${name}** (re-export)`);
        }
    }

    if (/export\s+default\s+(?!(async\s+)?(function|class)\s+[A-Za-z0-9_$])/.test(content)) {
        nodes.push('- **default** (default export)');
    }

    const cjsObject = /module\.exports\s*=\s*\{([^}]*)\}/g;
    while ((m = cjsObject.exec(content)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(':')[0].trim();
            if (/^[A-Za-z0-9_$]+$/.test(name)) nodes.push(`- **${name}** (commonjs export)`);
        }
    }
    const cjsProp = /(?:module\.)?exports\.([A-Za-z0-9_$]+)\s*=/g;
    while ((m = cjsProp.exec(content)) !== null) nodes.push(`- **${m[1]}** (commonjs export)`);

    return nodes;
}

function analyzeJava(content) {
    const nodes = [];
    const re = /(?:public\s+|protected\s+)?(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+([A-Za-z0-9_]+)/g;
    let m;
    while ((m = re.exec(content)) !== null) nodes.push(`- **${m[2]}** (${m[1]})`);
    return nodes;
}

function analyzePython(content) {
    const nodes = [];
    const re = /^(async\s+def|def|class)\s+([A-Za-z0-9_]+)/gm;
    let m;
    while ((m = re.exec(content)) !== null) nodes.push(`- **${m[2]}** (${m[1].replace(/\s+/g, ' ')})`);
    return nodes;
}

export function analyzeFile(relativePath, content) {
    if (JS_FAMILY.test(relativePath)) return analyzeJs(content);
    if (/\.java$/i.test(relativePath)) return analyzeJava(content);
    if (/\.py$/i.test(relativePath)) return analyzePython(content);
    return [];
}

export function parseMapFiles(mapText) {
    return new Set(
        mapText.split('\n')
            .filter(line => line.startsWith('### 📄 '))
            .map(line => line.replace('### 📄 ', '').trim())
    );
}

/** Собирает карту и сохраняет её в .dev-agent/PROJECT_MAP.md */
export function buildProjectMap(targetProject = config.workspace.targetProject) {
    const { targetAbsolute, stateDir, mapFile } = getStatePaths(targetProject);
    console.log(`🔍 Сканирую проект: ${targetAbsolute}`);

    const files = listProjectFiles(targetAbsolute).filter(f => INDEXABLE.test(f));

    let markdown = `# PROJECT MAP: ${path.basename(targetAbsolute)}\n\n`;
    markdown += '> Structural overview of the project to help the LLM navigate the codebase efficiently.\n\n';

    for (const relativePath of files) {
        const fullPath = path.join(targetAbsolute, relativePath);
        let nodes = [];
        let lines = 0;
        try {
            if (fs.statSync(fullPath).size <= MAX_ANALYZE_BYTES) {
                const content = fs.readFileSync(fullPath, 'utf-8');
                lines = content.split('\n').length;
                nodes = analyzeFile(relativePath, content);
            }
        } catch { /* нечитаемый файл остаётся в карте без индекса */ }

        markdown += `### 📄 ${relativePath}\n`;
        if (lines) markdown += `- _${lines} lines_\n`;
        markdown += nodes.length ? `${nodes.join('\n')}\n\n` : '- (no exported symbols indexed)\n\n';
    }

    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(mapFile, markdown, 'utf-8');
    console.log(`✅ Карта проекта: ${files.length} файлов → ${path.relative(targetAbsolute, mapFile).replace(/\\/g, '/')}`);
    return { mapFile, fileCount: files.length };
}

/** @returns {{text: string, files: Set<string>} | null} */
export function readProjectMap(targetProject = config.workspace.targetProject) {
    const { mapFile } = getStatePaths(targetProject);
    if (!fs.existsSync(mapFile)) return null;
    const text = fs.readFileSync(mapFile, 'utf-8');
    return { text, files: parseMapFiles(text) };
}

/** Читает карту, а если её нет — строит. */
export function ensureProjectMap(targetProject = config.workspace.targetProject) {
    return readProjectMap(targetProject) ?? (buildProjectMap(targetProject), readProjectMap(targetProject));
}
