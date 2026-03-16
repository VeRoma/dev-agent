import readline from "readline";
import fs from "fs";
import path from "path";
import { getProjectFiles, readFilesContent } from "../fs/file-manager.js";
import {
    initSession,
    appendToSession,
    getSession,
    clearSession,
} from "../core/session.js";
import { askModel } from "../core/llm.js";
import { determineRelevantFiles } from "../core/routing.js";
import { generateDocumentation, generateIndexes } from '../fs/docs-generator.js';
import { applyPatches, abortSessionPatches, clearSessionBackups, applyRedoPatches } from '../fs/patcher.js';

const configPath = path.join(process.cwd(), "agent.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

export function startCLI() {
    console.log(`\n🚀 Dev-Agent initialized!`);
    console.log(`🧠 Executor: ${config.llm.executorModel}`);
    console.log(`📂 Working directory: ${config.workspace.targetProject}\n`);

    initSession("Current development (General)");
    chatLoop();
}

async function handleCommand(command) {
    switch (command.toLowerCase()) {
        case '/save':
            console.log('\n💾 Starting save process...');
            const currentSession = getSession();
            await generateDocumentation(config.workspace.targetProject, currentSession);
            
            clearSession();
            clearSessionBackups();
            
            initSession('New task (waiting...)');
            console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
            break;
            
        case "/index":
            await generateIndexes(config.workspace.targetProject);
            break;
            
        case "/abort":
            console.log("\n🗑️ Aborting current task...");
            await abortSessionPatches(config.workspace.targetProject);
            clearSession();
            initSession('Task aborted (waiting...)');
            console.log("🛑 Task aborted. AI memory erased. Files reverted.");
            break;

        case "/redo":
            console.log("\n🔄 Restoring aborted task...");
            const isRedone = await applyRedoPatches(config.workspace.targetProject);
            if (isRedone) {
                console.log("⏩ Task restored. AI memory reloaded. Files reverted to modified state.");
            }
            break;
            
        case "/push":
            console.log("\n🚀 Preparing release...");
            console.log("   [To be implemented: generate commit message -> git add, commit, push]");
            break;
            
        default:
            console.log("\n⚠️ Unknown command. Available: /save, /index, /abort, /redo, /push");
    }
}

function chatLoop() {
    rl.question('🧑 Your question (or "exit" to quit): ', async (answer) => {
        const text = answer.trim();

        if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
            console.log("👋 Shutting down. See you!");
            rl.close();
            return;
        }

        if (!text) {
            chatLoop();
            return;
        }

        if (text.startsWith("/")) {
            await handleCommand(text);
            chatLoop();
            return;
        }

        console.log("🤖 Agent is gathering context...");
        appendToSession("user", text);

        try {
            const relevantFiles = await determineRelevantFiles(
                text,
                config.workspace.targetProject,
            );

            console.log(`📂 Files selected for analysis: ${relevantFiles.length}`);
            if (relevantFiles.length > 0) {
                relevantFiles.forEach((f) =>
                    console.log(`   - ${path.basename(f)}`),
                );
            }

            const targetAbsolute = path.resolve(process.cwd(), config.workspace.targetProject);
            const filesContext = readFilesContent(relevantFiles, targetAbsolute);
            const sessionContext = getSession();

            // === ОБНОВЛЕННЫЙ ПРОМПТ ДЛЯ DUAL-MODE ===
            const prompt = `
CODE CONTEXT:
${filesContext || "No files required."}

CURRENT SESSION:
${sessionContext}

CRITICAL INSTRUCTIONS:
1. You are an autonomous Senior Software Architect and Developer.
2. You MUST respond ONLY with a valid JSON object. Do not use markdown wrappers like \`\`\`json.
3. Choose your "mode" carefully:
   - Use "chat" mode if the user is asking a question, requesting an explanation, planning, or discussing architecture. In this mode, provide your detailed response in "message" (Markdown is allowed here) and leave "filesToUpdate" empty.
   - Use "patch" mode ONLY if the user explicitly asks to write, modify, or delete code. In this mode, "message" must be a short summary of what you changed, and "filesToUpdate" must contain the full updated file contents.
4. The "message" field MUST be written in Russian.

Expected JSON format:
{
  "mode": "chat" | "patch",
  "message": "Detailed response (for chat) OR short action summary (for patch) in Russian.",
  "filesToUpdate": [
    {
      "path": "app/components/FileName.tsx",
      "content": "// ... entire file content here (not just diff, the FULL file) ..."
    }
  ]
}

Answer the developer's last message:
`;

            console.log("🤖 Executor (Pro) is thinking/coding...");
            const rawResponse = await askModel(prompt, false);

            const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedResponse = JSON.parse(cleanJson);

            console.log(`\n================ AGENT RESPONSE [${parsedResponse.mode ? parsedResponse.mode.toUpperCase() : 'UNKNOWN'}] ================`);
            
            // Ветвление логики на основе режима
            if (parsedResponse.mode === 'chat') {
                // В режиме чата выводим полный ответ и не трогаем файлы
                console.log(parsedResponse.message);
                console.log("========================================================\n");
                
                appendToSession("agent", parsedResponse.message);
                
            } else if (parsedResponse.mode === 'patch') {
                // В режиме патча выводим только короткую мысль и меняем файлы
                console.log(`💡 ${parsedResponse.message}`);
                console.log("========================================================\n");
                
                if (parsedResponse.filesToUpdate && parsedResponse.filesToUpdate.length > 0) {
                    await applyPatches(config.workspace.targetProject, parsedResponse.filesToUpdate);
                }
                
                // В историю сессии пишем пометку, что был применен патч, чтобы ИИ это помнил
                appendToSession("agent", `[PATCH APPLIED]: ${parsedResponse.message}`);
            } else {
                // На случай если ИИ сгаллюцинирует режим
                console.log(parsedResponse.message || "No message provided.");
                console.log("========================================================\n");
                appendToSession("agent", JSON.stringify(parsedResponse));
            }

        } catch (error) {
            console.error("\n❌ Processing error (model might not have returned valid JSON):", error.message);
        }

        chatLoop();
    });
}