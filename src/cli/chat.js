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

const configPath = path.join(process.cwd(), "agent.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

export function startCLI() {
	console.log(`\n🚀 Dev-Agent запущен!`);
	console.log(`🧠 Исполнитель: ${config.llm.executorModel}`);
	console.log(`📂 Рабочая директория: ${config.workspace.targetProject}\n`);

	initSession("Текущая разработка (General)");
	chatLoop();
}

// Обработчик системных команд
async function handleCommand(command) {
	switch (command.toLowerCase()) {
		case "/save":
			console.log("\n💾 Запускаю процесс фиксации...");
			console.log(
				"   [Здесь будет: выжимка сути -> запись CHANGELOG.md -> обновление HISTORY.md]",
			);
			break;
		case "/abort":
			console.log("\n🗑️ Отменяю текущую задачу...");
			console.log("   [Здесь будет: откат файлов -> очистка сессии]");
			break;
		case "/push":
			console.log("\n🚀 Готовлю релиз...");
			console.log(
				"   [Здесь будет: генерация commit message -> git add, commit, push]",
			);
			break;
		default:
			console.log(
				"\n⚠️ Неизвестная команда. Доступные: /save, /abort, /push",
			);
	}
}

function chatLoop() {
	rl.question('🧑 Твой вопрос (или "exit" для выхода): ', async (answer) => {
		const text = answer.trim();

		if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
			console.log("👋 Завершаю работу. До встречи!");
			rl.close();
			return;
		}

		if (!text) {
			chatLoop();
			return;
		}

		// 🛑 ПЕРЕХВАТ КОМАНД СТРОГО ЗДЕСЬ (до записи в историю и до вызова ИИ)
		if (text.startsWith("/")) {
			await handleCommand(text);
			chatLoop(); // Возвращаемся к ожиданию ввода
			return;
		}

		console.log("🤖 Агент собирает контекст...");
		appendToSession("user", text);

		try {
			const relevantFiles = await determineRelevantFiles(
				text,
				config.workspace.targetProject,
			);

			console.log(
				`📂 Выбрано файлов для анализа: ${relevantFiles.length}`,
			);
			if (relevantFiles.length > 0) {
				relevantFiles.forEach((f) =>
					console.log(`   - ${path.basename(f)}`),
				);
			}

			const filesContext = readFilesContent(relevantFiles);
			const sessionContext = getSession();

			const prompt = `
КОНТЕКСТ КОДА:
${filesContext || "Файлы не требуются."}

ТЕКУЩАЯ СЕССИЯ:
${sessionContext}

Ответь на последнее сообщение разработчика.
`;

			console.log("🤖 Исполнитель (Pro) пишет ответ...");
			const response = await askModel(prompt, false);

			console.log("\n================ ОТВЕТ АГЕНТА ================");
			console.log(response);
			console.log("==============================================\n");

			appendToSession("agent", response);
		} catch (error) {
			console.error("\n❌ Ошибка в процессе обработки:", error.message);
		}

		chatLoop();
	});
}


//!
