import fs from 'fs';
import { getProjectFiles } from './src/fs/file-manager.js';

// Читаем конфиг, чтобы узнать, куда смотреть
const configPath = './agent.config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const targetProject = config.workspace.targetProject;

console.log(`🔍 Сканируем проект: ${targetProject} ...\n`);

// Получаем список файлов
const files = getProjectFiles(targetProject);

console.log('✅ Найденные файлы (которые разрешено читать агенту):');
files.forEach(f => console.log(' -', f));

console.log(`\nВсего файлов для анализа: ${files.length}`);