import readline from 'readline';

// Один readline на весь процесс, и ВСЕ строки ввода идут через один обработчик 'line':
// если кто-то ждёт ответа (выбор проекта, подтверждение) — строка достаётся ему, иначе — чату.
// С rl.question так нельзя: пока чат ждёт «>>», второй вопрос (подтверждение из фоновой
// авто-починки) игнорируется, и ответ «y» уходил агенту как новая задача.
let rl = null;
let pendingAnswer = null;  // resolve того, кто ждёт ответа на вопрос
let lineHandler = null;    // чат
let closeHandler = null;
const buffered = [];       // строки, пришедшие раньше, чем их кто-то ждёт (ввод через конвейер)

const YES = /^(y|yes|д|да)$/i;

function getRl() {
    if (rl) return rl;
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('>> ');
    rl.on('line', (line) => {
        if (pendingAnswer) {
            const resolve = pendingAnswer;
            pendingAnswer = null;
            resolve(line);
        } else if (lineHandler) {
            lineHandler(line);
        } else {
            buffered.push(line);
        }
    });
    rl.on('close', () => {
        rl = null;
        if (pendingAnswer) {
            const resolve = pendingAnswer;
            pendingAnswer = null;
            resolve(null);
        }
        closeHandler?.();
    });
    return rl;
}

/** Задаёт вопрос и возвращает ответ; null — если ввод закрыт (Ctrl+D, конец потока). */
export function ask(question) {
    process.stdout.write(question);
    if (buffered.length > 0) return Promise.resolve(buffered.shift());
    if (!getRl()) return Promise.resolve(null);
    return new Promise((resolve) => { pendingAnswer = resolve; });
}

/**
 * Подтверждение y/N.
 * @param {{whenNoTerminal?: boolean}} [options] ответ, если интерактивного терминала нет (Telegram-бот); по умолчанию «нет»
 */
export async function askConfirm(question, { whenNoTerminal = false } = {}) {
    if (!process.stdin.isTTY) {
        console.log(whenNoTerminal
            ? '⚙️ [SYSTEM] Нет интерактивного терминала — выполняю без подтверждения.'
            : '⚙️ [SYSTEM] Нет интерактивного терминала — действие отклонено автоматически.');
        return whenNoTerminal;
    }
    const answer = await ask(question);
    return YES.test((answer ?? '').trim());
}

/** Чат: получает каждую строку, на которую никто не ждёт ответа. */
export function onInputLine(handler, onClose) {
    lineHandler = handler;
    closeHandler = onClose;
    getRl();
    while (buffered.length > 0 && lineHandler) lineHandler(buffered.shift());
}

export function showPrompt() {
    if (!rl) return;
    process.stdout.write('\n');
    rl.prompt();
}

export function closeTerminal() {
    lineHandler = null;
    if (rl) rl.close();
}
