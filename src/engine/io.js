// Мост между движком и интерфейсом: движок не знает про readline, а интерфейс
// регистрирует здесь функцию подтверждения. Без интерфейса (тесты, Telegram) всё отклоняется.
let confirmHandler = async () => false;

export function setConfirmHandler(handler) {
    confirmHandler = handler;
}

/** Спрашивает у разработчика подтверждение действия. */
export function confirm(question) {
    return confirmHandler(question);
}
