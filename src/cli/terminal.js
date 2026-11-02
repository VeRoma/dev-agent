import readline from 'readline';

// Один readline на весь процесс (раньше их было два на одном stdin).
let rl = null;

function getRl() {
    if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return rl;
}

/** Задаёт вопрос и возвращает ответ; null — если ввод закрыт (Ctrl+D, конец потока). */
export function ask(question) {
    return new Promise((resolve) => {
        const terminal = getRl();
        const onClose = () => resolve(null);
        terminal.once('close', onClose);
        terminal.question(question, (answer) => {
            terminal.off('close', onClose);
            resolve(answer);
        });
    });
}

/** Подтверждение y/N. Без интерактивного терминала (Telegram-бот) всегда «нет». */
export async function askConfirm(question) {
    if (!process.stdin.isTTY) {
        console.log('⚙️ [SYSTEM] Нет интерактивного терминала — действие отклонено автоматически.');
        return false;
    }
    const answer = await ask(question);
    return /^(y|yes|д|да)$/i.test((answer ?? '').trim());
}

export function closeTerminal() {
    if (rl) {
        rl.close();
        rl = null;
    }
}
