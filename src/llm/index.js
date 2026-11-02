// src/llm/index.js — thin re-export shim over the active dynamic ai-core adapter (core/llm.js).
// The real implementation lives in core/llm.js; this module only restores the import
// paths used by engine/* and tests/* (../llm/index.js) without duplicating logic.
export {
    ai,
    ask,
    askModel,
    askLocal,
    fallbackChain,
    modelForTier,
    translateToEnglish,
    translateToRussianIfEnglish,
    pickProvider,
    isLocalModel,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
} from '../../core/llm.js';
