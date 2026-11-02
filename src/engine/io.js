// Мост между движком и интерфейсом: движок не знает про readline, а интерфейс регистрирует
// здесь свои обработчики. Без интерфейса (тесты, Telegram) подтверждения — отказ,
// а фоновые задачи выполняются сразу.
let confirmHandler = async () => false;
let exclusiveRunner = async (task) => { await task(); return true; };

export function setConfirmHandler(handler) {
    confirmHandler = handler;
}

/**
 * Спрашивает у разработчика подтверждение действия.
 * @param {{whenNoTerminal?: boolean}} [options] ответ, если спросить некого (по умолчанию — отказ)
 */
export function confirm(question, options = {}) {
    return confirmHandler(question, options);
}

/** Интерфейс решает, как выполнить фоновую задачу (например, не параллельно с задачей из чата). */
export function setExclusiveRunner(runner) {
    exclusiveRunner = runner;
}

/**
 * Выполняет фоновую задачу (авто-исправление после падения), если агент свободен.
 * @returns {Promise<boolean>} false — агент занят другой задачей, фоновая не запускалась
 */
export function runExclusive(task) {
    return exclusiveRunner(task);
}
