import path from 'path';

// Directories the agent must never write to or delete from (lowercase keys for case-insensitive matching)
const PROTECTED_DIRS = new Set(['.git', '.dev-agent', '.meta-agent', '.agent_backup', 'node_modules']);

// Exact filenames (lowercase) that always contain secrets
const SECRET_FILE_NAMES = new Set(['.npmrc', '.netrc', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);

// File extensions (lowercase) that always contain secrets
const SECRET_FILE_EXTENSIONS = new Set(['.pem', '.key']);

// Base names without extension (lowercase) treated as secrets, e.g. credentials.json / secrets.yaml
const SECRET_BASE_NAMES = new Set(['credentials', 'secrets']);

/**
 * Resolves a model-supplied path against the project root and guarantees
 * the result stays inside that root (blocks "../" traversal and absolute paths).
 */
export function resolveInside(rootAbsolute, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
        throw new Error('Empty or invalid file path');
    }
    if (relativePath.includes('\0')) {
        throw new Error('File path contains a null byte');
    }

    const root = path.resolve(rootAbsolute);
    const resolved = path.resolve(root, relativePath);
    const rel = path.relative(root, resolved);

    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw new Error(`Path escapes the project root: ${relativePath}`);
    }
    return resolved;
}

/** Secrets: must never be sent to a cloud LLM. */
export function isSecretPath(relPath) {
    const base = relPath.split(/[\\/]/).filter(Boolean).pop() || '';
    const lower = base.toLowerCase();

    if (/^\.env(\..+)?$/.test(lower)) {
        return !/\.(example|sample|template)$/.test(lower);
    }
    if (SECRET_FILE_NAMES.has(lower)) return true;

    const ext = path.extname(lower);
    if (SECRET_FILE_EXTENSIONS.has(ext)) return true;

    const stem = ext ? lower.slice(0, -ext.length) : lower;
    return SECRET_BASE_NAMES.has(stem);
}

/** Paths the agent may neither modify nor delete (case-insensitive on Windows/macOS filesystems). */
export function isProtectedPath(relPath) {
    const parts = relPath.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.some(p => PROTECTED_DIRS.has(p.toLowerCase()))) return true;
    return isSecretPath(relPath);
}

/**
 * Resolve + protect: returns both absolute and POSIX-style relative path,
 * or throws if the path is unsafe to write.
 */
export function resolveProjectFile(rootAbsolute, filePath) {
    const absolutePath = resolveInside(rootAbsolute, filePath);
    const relativePath = path
        .relative(path.resolve(rootAbsolute), absolutePath)
        .split(path.sep)
        .join('/');

    if (isProtectedPath(relativePath)) {
        throw new Error(`Path is protected and cannot be modified: ${relativePath}`);
    }
    return { absolutePath, relativePath };
}
