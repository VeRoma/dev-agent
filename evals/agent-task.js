// Runs ONE eval task with the real agent engine in this process.
// Started by evals/run.js: a separate process per task = own config, session and usage state,
// and all agent output goes to the task log. Usage: node evals/agent-task.js <taskId> <fixtureDir> <resultFile>
import fs from 'fs';

process.env.DEV_AGENT_NO_EDITOR = '1';

const [taskId, dir, resultFile] = process.argv.slice(2);
const { TASKS } = await import('./tasks.js');
const { setTargetProject } = await import('../src/config.js');
const { buildProjectMap } = await import('../src/project/project-map.js');
const { initSession, getSession } = await import('../src/engine/session.js');
const { processAgentTask } = await import('../src/engine/task-runner.js');
const { getUsage } = await import('../src/llm/usage.js');

const task = TASKS.find(t => t.id === taskId);
if (!task) {
    console.error(`Unknown eval task: ${taskId}`);
    process.exit(2);
}

// No confirm handler is registered: risky commands are denied, as in Telegram mode
setTargetProject(dir);
buildProjectMap(dir);
initSession(`eval: ${task.id}`);

const started = Date.now();
let error = null;
try {
    await processAgentTask(task.prompt);
} catch (e) {
    error = e.message;
}

fs.writeFileSync(resultFile, JSON.stringify({ ms: Date.now() - started, error, usage: getUsage(), session: getSession() }));
// A restartServer request may leave a child process behind: do not wait for it
process.exit(0);
