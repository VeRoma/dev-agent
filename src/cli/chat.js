import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process"; // <-- НОВЫЙ ИМПОРТ для /editor
import { getProjectFiles, readFilesContent } from "../fs/file-manager.js";
import {
	initSession,
	appendToSession,
	getSession,
	clearSession,
} from "../core/session.js";
import { askModel } from "../core/llm.js";
import { determineRelevantFiles } from "../core/routing.js";
import {
	generateDocumentation,
	generateIndexes,
} from "../fs/docs-generator.js";
import {
	applyPatches,
	abortSessionPatches,
	clearSessionBackups,
	applyRedoPatches,
} from "../fs/patcher.js";

const configPath = path.join(process.cwd(), "agent.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

export function startCLI() {
	console.log(`\n🚀 Dev-Agent initialized!`);
	console.log(`🧠 Executor: ${config.llm.executorModel}`);
	console.log(`📂 Working directory: ${config.workspace.targetProject}`);

	initSession("Current development (General)");
	chatLoop();
}

async function handleCommand(command) {
	switch (command.toLowerCase()) {
		case "/save":
			console.log("\n💾 Starting save process...");
			const currentSession = getSession();
			await generateDocumentation(
				config.workspace.targetProject,
				currentSession,
			);
			await generateIndexes(config.workspace.targetProject);
			clearSession();
			clearSessionBackups();
			initSession("New task (waiting...)");
			console.log(
				"🧹 Temporary session and backups cleared. Ready for a new task!",
			);
			break;

		case "/index":
			await generateIndexes(config.workspace.targetProject);
			break;

		case "/abort":
			console.log("\n🗑️ Aborting current task...");
			await abortSessionPatches(config.workspace.targetProject);
			clearSession();
			initSession("Task aborted (waiting...)");
			console.log("🛑 Task aborted. AI memory erased. Files reverted.");
			break;

		case "/redo":
			console.log("\n🔄 Restoring aborted task...");
			const isRedone = await applyRedoPatches(
				config.workspace.targetProject,
			);
			if (isRedone) {
				console.log(
					"⏩ Task restored. AI memory reloaded. Files reverted to modified state.",
				);
			}
			break;

		case "/clear": // <-- НОВАЯ КОМАНДА: Очистка только памяти чата
			clearSession();
			initSession("Context cleared");
			console.log("\n🧹 AI memory cleared. Let's start a fresh topic!");
			break;

		case "/push":
			console.log("\n🚀 Preparing release...");
			console.log(
				"   [To be implemented: generate commit message -> git add, commit, push]",
			);
			break;

		default:
			console.log(
				"\n⚠️ Unknown command. Available: /save, /index, /abort, /redo, /clear, /editor, /push",
			);
	}
}

function chatLoop() {
	// <-- ИЗМЕНЕН ПРОМПТ НА ЛАКОНИЧНЫЙ >>
	rl.question("\n>> ", async (answer) => {
		let text = answer.trim();

		if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
			console.log("👋 Shutting down. See you!");
			rl.close();
			return;
		}

		// --- 1. ЛОГИКА МНОГОСТРОЧНОГО ВВОДА (/editor) ---
		if (text === "/editor") {
			const tempPromptFile = path.join(
				process.cwd(),
				".agent_prompt.tmp",
			);
			fs.writeFileSync(
				tempPromptFile,
				"// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n",
				"utf-8",
			);
			console.log(
				"📝 Opening VS Code for multi-line input (waiting for you to save and close the tab)...",
			);
			try {
				// --wait заставит Node.js ждать, пока ты не закроешь вкладку в VS Code
				execSync(`code --wait "${tempPromptFile}"`);

				// Читаем, что ты написал, и убираем первую строку-инструкцию
				const editorText = fs
					.readFileSync(tempPromptFile, "utf-8")
					.replace(
						"// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n",
						"",
					)
					.trim();

				if (!editorText) {
					console.log("⚠️ Prompt is empty. Canceled.");
					chatLoop();
					return;
				}

				text = editorText; // Подменяем текст на то, что из редактора
				console.log(`\n[Multiline Input Received]`);
			} catch (error) {
				console.log(
					'⚠️ Could not open editor. Make sure "code" command is in your PATH.',
				);
				chatLoop();
				return;
			}
		}

		if (!text) {
			chatLoop();
			return;
		}

		if (text.startsWith("/") && text !== "/editor") {
			await handleCommand(text);
			chatLoop();
			return;
		}

		console.log("🤖 Agent is gathering context...");
		appendToSession("user", text);

		try {
			// --- 2. ЛОГИКА ПРЯМЫХ УПОМИНАНИЙ (@) ---
			const mentionRegex = /@([a-zA-Z0-9_.-]+)/g;
			const mentions = [...text.matchAll(mentionRegex)].map((m) => m[1]);
			const allProjectFiles = getProjectFiles(
				config.workspace.targetProject,
			);
			let forcedFiles = [];

			if (mentions.length > 0) {
				for (const mention of mentions) {
					// Ищем файл по точному имени (с расширением или без)
					const matched = allProjectFiles.find((f) => {
						const base = path.basename(f);
						const nameWithoutExt = base.replace(/\.[^/.]+$/, "");
						return base === mention || nameWithoutExt === mention;
					});

					if (matched) {
						forcedFiles.push(matched);
						console.log(`📌 Explicitly included: ${mention}`);
					} else {
						console.log(
							`⚠️ Mentioned file not found in project: ${mention}`,
						);
					}
				}
			}

			// Получаем файлы от ИИ-маршрутизатора
			let relevantFiles = await determineRelevantFiles(
				text,
				config.workspace.targetProject,
			);

			// Объединяем "умные" файлы и "принудительные", убирая дубликаты
			relevantFiles = [...new Set([...forcedFiles, ...relevantFiles])];

			console.log(
				`📂 Files selected for analysis: ${relevantFiles.length}`,
			);
			if (relevantFiles.length > 0) {
				relevantFiles.forEach((f) =>
					console.log(`   - ${path.basename(f)}`),
				);
			}

			const targetAbsolute = path.resolve(
				process.cwd(),
				config.workspace.targetProject,
			);
			const filesContext = readFilesContent(
				relevantFiles,
				targetAbsolute,
			);
			const sessionContext = getSession();

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

			const cleanJson = rawResponse
				.replace(/```json/g, "")
				.replace(/```/g, "")
				.trim();
			const parsedResponse = JSON.parse(cleanJson);

			console.log(
				`\n================ AGENT RESPONSE [${parsedResponse.mode ? parsedResponse.mode.toUpperCase() : "UNKNOWN"}] ================`,
			);

			if (parsedResponse.mode === "chat") {
				console.log(parsedResponse.message);
				console.log(
					"========================================================\n",
				);
				appendToSession("agent", parsedResponse.message);
			} else if (parsedResponse.mode === "patch") {
				console.log(`💡 ${parsedResponse.message}`);
				console.log(
					"========================================================\n",
				);

				if (
					parsedResponse.filesToUpdate &&
					parsedResponse.filesToUpdate.length > 0
				) {
					await applyPatches(
						config.workspace.targetProject,
						parsedResponse.filesToUpdate,
					);
				}
				appendToSession(
					"agent",
					`[PATCH APPLIED]: ${parsedResponse.message}`,
				);
			} else {
				console.log(parsedResponse.message || "No message provided.");
				console.log(
					"========================================================\n",
				);
				appendToSession("agent", JSON.stringify(parsedResponse));
			}
		} catch (error) {
			console.error(
				"\n❌ Processing error (model might not have returned valid JSON):",
				error.message,
			);
		}

		chatLoop();
	});
}
