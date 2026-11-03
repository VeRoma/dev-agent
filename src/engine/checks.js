import { runLinter } from './linter.js';
import { runTests } from './tester.js';

/**
 * Линтер -> тесты. Проблемы окружения дают предупреждения, а не «ошибки кода».
 * @returns {Promise<{success: true} | {success: false, kind: 'Linter'|'Tests', output: string}>}
 */
export async function runProjectChecks(targetProject, updatedFiles) {
    const lint = await runLinter(targetProject, updatedFiles);
    (lint.warnings || []).forEach(w => console.log(`⚠️ ${w}`));
    if (!lint.ok) return { success: false, kind: 'Linter', output: lint.output };

    console.log('✅ Линтер: ошибок кода нет. Запуск юнит-тестов...');
    const tests = await runTests(targetProject, updatedFiles);
    (tests.warnings || []).forEach(w => console.log(`⚠️ ${w}`));
    if (!tests.ok) return { success: false, kind: 'Tests', output: tests.output };

    return { success: true };
}
