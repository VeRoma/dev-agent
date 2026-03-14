import fs from 'fs';
import path from 'path';

const SESSION_FILE = path.join(process.cwd(), '.agent_session.tmp');

export function initSession(taskName) {
    const initialContent = `# Сессия: ${taskName}\n**Статус:** В работе\n\n## 🔄 Журнал попыток и диалог\n`;
    fs.writeFileSync(SESSION_FILE, initialContent, 'utf-8');
    return initialContent;
}

export function getSession() {
    if (!fs.existsSync(SESSION_FILE)) {
        return null;
    }
    return fs.readFileSync(SESSION_FILE, 'utf-8');
}

export function appendToSession(role, text) {
    if (!fs.existsSync(SESSION_FILE)) return;
    
    const prefix = role === 'user' ? '\n🧑 **Разработчик:** ' : '\n🤖 **Агент:** ';
    fs.appendFileSync(SESSION_FILE, `${prefix}${text}\n`, 'utf-8');
}

export function clearSession() {
    if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
    }
}