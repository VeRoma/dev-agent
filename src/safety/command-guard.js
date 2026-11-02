// Decides whether a shell command proposed by the LLM may run automatically.

// Any of these makes a command "not trivially safe" (chaining, redirects, substitution).
// % — cmd.exe expands %VAR%: git commit -m "%GEMINI_API_KEY%" would write the key into git history.
const SHELL_META = /[;&|<>`%\n\r]|\$\(/;

const SAFE_PATTERNS = [
    /^npm (?:install|i|ci)$/,                       // bare install only: no new packages
    /^npm test$/,
    /^npm run [\w:.-]+$/,
    /^git (?:status|diff|log)(?: [\w./\\:@~^-]+)*$/,
    /^git add [\w./\\-]+(?: [\w./\\-]+)*$/,
    /^git commit -m "[^"`$\\\r\n;&|<>]*"$/,
    /^node --check [\w./\\-]+$/,
];

const DANGEROUS_PATTERNS = [
    [/\brm\s+-[a-z]*[rf]/i, 'рекурсивное/принудительное удаление'],
    [/\b(?:del|rmdir|rd)\s+\/[a-z]/i, 'массовое удаление (Windows)'],
    [/\bRemove-Item\b.*-Recurse/i, 'рекурсивное удаление (PowerShell)'],
    [/\bsudo\b/i, 'sudo'],
    [/\bformat\s+[a-z]:/i, 'форматирование диска'],
    [/\b(?:curl|wget|iwr|Invoke-WebRequest)\b/i, 'загрузка из сети'],
    [/\|\s*(?:sh|bash|zsh|powershell|pwsh|iex)\b/i, 'выполнение скачанного кода'],
    [/\bgit\s+(?:reset\s+--hard|clean\b)|\bgit\s+push\b.*--force/i, 'необратимая операция git'],
    [/\bnpm\s+(?:publish|login|adduser)\b/i, 'публикация/авторизация npm'],
    [/\.env\b/i, 'обращение к .env'],
];

/**
 * @returns {{level: 'safe'|'confirm', warning?: string}}
 */
export function classifyCommand(command) {
    const cmd = String(command ?? '').trim();
    if (!cmd) return { level: 'confirm', warning: 'пустая команда' };

    const warnings = DANGEROUS_PATTERNS.filter(([re]) => re.test(cmd)).map(([, why]) => why);

    if (warnings.length === 0 && !SHELL_META.test(cmd) && SAFE_PATTERNS.some(re => re.test(cmd))) {
        return { level: 'safe' };
    }
    return { level: 'confirm', warning: warnings.length ? warnings.join(', ') : undefined };
}
