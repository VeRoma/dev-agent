// What an external caller (the Telegram bot, DEV_TASK) may send to the agent.
// No heavy imports: the bot uses this module too.

// Report-style commands that make sense without a terminal; /run, /editor, /abort etc. do not
export const EXTERNAL_COMMANDS = ['/audit', '/self-diff', '/index'];

/**
 * @returns {'task' | 'command' | 'refused'} a plain text is a task for the model;
 *   a slash command runs as a command only if it is in EXTERNAL_COMMANDS
 */
export function classifyExternalTask(text) {
    const value = String(text ?? '').trim();
    if (!value.startsWith('/')) return 'task';
    const name = value.split(/\s+/)[0].toLowerCase();
    return EXTERNAL_COMMANDS.includes(name) ? 'command' : 'refused';
}
