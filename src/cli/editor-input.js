import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const HINT = '// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n';

/** /editor: многострочный ввод через VS Code. Возвращает текст либо null. */
export function readPromptViaEditor() {
    // Временный файл лежит в системной папке, а не в репозитории
    const file = path.join(os.tmpdir(), 'dev-agent-prompt.tmp');
    fs.writeFileSync(file, HINT, 'utf-8');
    console.log('📝 Opening VS Code for multi-line input (waiting for you to save and close the tab)...');

    try {
        execSync(`code --wait "${file}"`);
    } catch {
        console.log('⚠️ Could not open editor. Make sure "code" command is in your PATH.');
        return null;
    }

    // VS Code на Windows мог сохранить файл с CRLF
    const text = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n').replace(HINT, '').trim();
    if (!text) {
        console.log('⚠️ Prompt is empty. Canceled.');
        return null;
    }
    console.log('\n[Multiline Input Received]');
    return text;
}
