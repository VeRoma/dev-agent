import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// A file whose new content is smaller than this fraction of the old one is
// treated as a truncated model answer.
export const MIN_SIZE_RATIO = 0.4;
const MIN_SIZE_CHECK_BYTES = 800;

// Typical "lazy" placeholders weak models write instead of the real code.
const PLACEHOLDER_PATTERNS = [
    /\/\/\s*\.\.\.\s*\(.*\)\s*\.\.\./i,
    /\/\/\s*\.\.\.\s*existing code\s*\.\.\./i,
    /\/\/\s*\.\.\.[^\n]*(без изменений|unchanged|остальной|rest of)/i,
    /(остальной|остальные|прочий|прочие)\s+(код|функции|часть)[^\n]*(без изменений|остается|остаётся)/i,
    /(rest|remainder) of (the )?(code|file|function|implementation)[^\n]*(unchanged|same|omitted|here)/i,
];

export function findPlaceholder(content) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
        const match = content.match(pattern);
        if (match) return match[0].trim();
    }
    return null;
}

/**
 * Syntax-only check for JS. Tries ESM first, then CommonJS, so it works
 * regardless of which module system the target project uses.
 */
export function checkJsSyntax(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-agent-check-'));
    let firstError = '';
    try {
        for (const ext of ['.mjs', '.cjs']) {
            const file = path.join(dir, `check${ext}`);
            fs.writeFileSync(file, content, 'utf-8');
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' });
            if (result.status === 0) return { ok: true };
            if (!firstError) firstError = (result.stderr || '').split('\n').slice(0, 6).join('\n').trim();
        }
        return { ok: false, error: firstError };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Validates one proposed file write BEFORE anything touches the disk.
 * @param {string} relPath   POSIX-style path relative to project root
 * @param {string|null} previous  current content, or null if the file is new
 * @param {*} next           content proposed by the model
 */
export function validateFileUpdate(relPath, previous, next) {
    if (typeof next !== 'string') {
        return { ok: false, reason: 'file content must be a string' };
    }

    const placeholder = findPlaceholder(next);
    if (placeholder && !(previous && previous.includes(placeholder))) {
        return { ok: false, reason: `content contains a placeholder instead of real code ("${placeholder.slice(0, 80)}")` };
    }

    if (previous !== null && previous.trim().length > 0) {
        if (next.trim().length === 0) {
            return { ok: false, reason: 'new content is empty but the file is not' };
        }
        if (previous.length >= MIN_SIZE_CHECK_BYTES && next.length < previous.length * MIN_SIZE_RATIO) {
            return {
                ok: false,
                reason: `new content is ${Math.round((next.length / previous.length) * 100)}% of the old size — looks truncated`,
            };
        }
    }

    if (/\.(m|c)?js$/i.test(relPath)) {
        const syntax = checkJsSyntax(next);
        if (!syntax.ok) {
            return { ok: false, reason: `JavaScript syntax error:\n${syntax.error}` };
        }
    }

    return { ok: true };
}
