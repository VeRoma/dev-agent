import { listAvailableModels, pickProvider } from '../llm/index.js';

/**
 * Shows whether every model from agent.config.json exists at its provider. Changes nothing:
 * the config is the only source of model choice.
 * 🟢 the provider has the model, 🟡 the provider answers but has no such model, 🔴 the provider is unavailable.
 */
export async function reportModels(llm) {
    const tiers = llm.tiers ?? {};
    const roles = [
        ['Оркестратор', llm.orchestratorModel ?? tiers.pro],
        ['Локальная (local)', tiers.local],
        ['Исполнитель (fast)', tiers.fast],
        ['Хирург (pro)', tiers.pro],
        ['Архитектор (arch)', tiers.arch],
        ...(llm.cloudFallbacks ?? []).map(m => ['Запасная', m]),
    ].filter(([, model]) => model);

    const available = await listAvailableModels();

    console.log('🧠 Модели из agent.config.json:');
    for (const [role, model] of roles) {
        const provider = pickProvider(model, llm.defaultProvider);
        const status = available[provider];
        let mark;
        if (!status) mark = '🔴 неизвестный провайдер';
        else if (status.error) mark = `🔴 ${provider}: ${status.error}`;
        else if (status.models.includes(model)) mark = '🟢';
        else mark = `🟡 у ${provider} нет такой модели`;
        console.log(`   • ${role.padEnd(19)}: ${model} ${mark}`);
    }
}
