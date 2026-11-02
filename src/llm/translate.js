// src/llm/translate.js — thin re-export shim over the translation helpers
// exposed by the active dynamic ai-core adapter (core/llm.js).
export {
    translateToEnglish,
    translateToRussianIfEnglish,
} from '../../core/llm.js';
