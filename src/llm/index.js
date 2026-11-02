// The only ai-core adapter of Dev-Agent: one AI facade per process.
// createAI keeps a reference to config.llm, so runtime changes (tests, project switch) are visible at once.
import {
    createAI,
    pickProvider,
    isLocalModel,
    listAvailableModels,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
} from '@veroma/ai-core';
import { config } from '../config.js';
import { recordUsage } from './usage.js';

export const ai = createAI({
    llm: config.llm,
    systemRole: config.prompts.systemRole,
    logPrefix: 'Dev-Agent',
    onUsage: recordUsage,
});

export const {
    ask,
    askModel,
    askLocal,
    orchestrate,
    fallbackChain,
    modelForTier,
    translateToEnglish,
    translateToRussianIfEnglish,
} = ai;

export {
    pickProvider,
    isLocalModel,
    listAvailableModels,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
};
