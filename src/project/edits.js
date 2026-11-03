/**
 * Search/replace edits: for an existing file the executor sends only the changed fragments
 * instead of the whole file. Edits apply in order, each to the result of the previous one,
 * and each `search` must match exactly one place. The result is the full new file, so every
 * guard (validateFileUpdate in ai-core) still checks the whole content.
 */

/** Rewrites line endings of a model fragment to the file's own (models send \n, Windows files may be \r\n). */
function toEol(text, eol) {
    const lf = String(text).replace(/\r\n/g, '\n');
    return eol === '\n' ? lf : lf.replace(/\n/g, eol);
}

function countOccurrences(haystack, needle) {
    let count = 0;
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
    return count;
}

const preview = (text) => JSON.stringify(String(text).split(/\r?\n/).find(l => l.trim()) ?? '').slice(0, 80);

/**
 * @param {string} previous current file content
 * @param {{search: string, replace: string}[]} edits
 * @returns {string} new content
 * @throws {Error} with a reason the executor can act on (sent back to it on retry)
 */
export function applyEdits(previous, edits) {
    if (!Array.isArray(edits) || edits.length === 0) throw new Error('"edits" must be a non-empty array of { search, replace }');
    const eol = previous.includes('\r\n') ? '\r\n' : '\n';
    let content = previous;

    edits.forEach((edit, i) => {
        const n = `edit #${i + 1}`;
        if (typeof edit?.search !== 'string' || edit.search.trim() === '') throw new Error(`${n}: "search" must be a non-empty string`);
        if (typeof edit.replace !== 'string') throw new Error(`${n}: "replace" must be a string (empty string deletes the fragment)`);

        const search = toEol(edit.search, eol);
        const found = countOccurrences(content, search);
        if (found === 0) {
            throw new Error(`${n}: "search" not found (starts with ${preview(edit.search)}). Copy it verbatim from the current file, including indentation`);
        }
        if (found > 1) {
            throw new Error(`${n}: "search" matches ${found} places (starts with ${preview(edit.search)}). Add surrounding lines so it is unique`);
        }
        const at = content.indexOf(search);
        content = content.slice(0, at) + toEol(edit.replace, eol) + content.slice(at + search.length);
    });
    return content;
}

/**
 * Full new content of a filesToUpdate entry: { path, content } or { path, edits }.
 * @param {{content?: string, edits?: object[]}} file
 * @param {string|null} previous current content, null if the file does not exist
 */
export function resolveFileContent(file, previous) {
    if (file?.edits === undefined) return file?.content;
    if (file.content !== undefined) throw new Error('use either "content" (full file) or "edits", not both');
    if (previous === null) throw new Error('"edits" need an existing file; send the full "content" for a new file');
    return applyEdits(previous, file.edits);
}
