import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getStatePaths } from '../project/state-paths.js';

function runProcess(command, args, cwd) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let child;
        try {
            child = spawn(command, args, { cwd, shell: process.platform === 'win32' });
        } catch (error) {
            resolve({ code: -1, stdout: '', stderr: String(error?.message ?? error) });
            return;
        }
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => resolve({ code: -1, stdout, stderr: String(error?.message ?? error) }));
        child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
}

function hasEslintConfig(projectRoot) {
    const candidates = [
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.eslintrc.yml',
        '.eslintrc.yaml',
    ];
    return candidates.some((name) => fs.existsSync(path.join(projectRoot, name)));
}

/**
 * Runs ESLint in the target project if it is installed and configured.
 * Missing ESLint / config are warnings, not code errors.
 */
export async function runLinter(projectRoot) {
    const root = getStatePaths(projectRoot).targetAbsolute;

    if (!hasEslintConfig(root)) {
        return { ok: true, warnings: ['ESLint config not found — linter skipped'], output: '' };
    }

    const result = await runProcess('npx', ['--no-install', 'eslint', '.'], root);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    if (result.code === -1 || /not found|is not recognized|Cannot find module/i.test(output)) {
        return { ok: true, warnings: ['ESLint is not installed in the target project — linter skipped'], output };
    }

    // shortcut: ESLint exit code 0 = clean, 1 = lint errors, 2 = config/fatal error.
    // Config/fatal errors are treated as warnings so they never block the pipeline.
    if (result.code === 2) {
        return { ok: true, warnings: ['ESLint reported a configuration error — treated as warning'], output };
    }

    const lines = output.split('\n').filter((line) => line.trim().length > 0);
    return { ok: result.code === 0, output, lines };
}
