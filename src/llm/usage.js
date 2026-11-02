// Token usage of the current task: every model call is recorded (ai-core onUsage),
// the task runner prints a summary at the end. Data first, optimization later.

let entries = [];

export function recordUsage(entry) {
    entries.push(entry);
}

export function resetUsage() {
    entries = [];
}

export function getUsage() {
    return [...entries];
}

const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * One-line-per-role summary. Cost is shown only when llm.pricing has the model:
 * pricing = { "<model>": { "input": <USD per 1M tokens>, "output": <USD per 1M tokens> } }.
 */
export function formatUsage(list, pricing = {}) {
    if (list.length === 0) return '';

    const groups = new Map();
    for (const e of list) {
        const key = `${e.label}|${e.model}`;
        const g = groups.get(key) ?? { label: e.label, model: e.model, calls: 0, failed: 0, input: 0, output: 0, unknown: false };
        g.calls++;
        if (!e.ok) g.failed++;
        if (e.ok && (e.inputTokens == null || e.outputTokens == null)) g.unknown = true;
        g.input += e.inputTokens ?? 0;
        g.output += e.outputTokens ?? 0;
        groups.set(key, g);
    }

    let totalIn = 0;
    let totalOut = 0;
    let cost = 0;
    let costComplete = true;
    const lines = [];
    for (const g of groups.values()) {
        totalIn += g.input;
        totalOut += g.output;
        const price = pricing[g.model];
        if (price) cost += (g.input * price.input + g.output * price.output) / 1e6;
        else if (g.input + g.output > 0) costComplete = false;

        const failed = g.failed ? `, ошибок: ${g.failed}` : '';
        const unknown = g.unknown ? ' (провайдер не сообщил токены)' : '';
        lines.push(`   • ${g.label.padEnd(12)} ${g.model}: ${g.calls} выз.${failed}, ${kilo(g.input)} → ${kilo(g.output)}${unknown}`);
    }

    const costText = cost > 0
        ? ` ≈ $${cost.toFixed(4)}${costComplete ? '' : ' (не для всех моделей заданы цены в llm.pricing)'}`
        : '';
    return `💰 Расход токенов (вход → выход):\n${lines.join('\n')}\n   Итого: ${kilo(totalIn)} → ${kilo(totalOut)}${costText}`;
}
