// src/index.js — public entry point re-exporting the library surface.
export { diffArray, diffLines, diffWords, diffChars, applyDiff, splitLines, splitWords } from './diff.js';
export { toUnifiedDiff, toColorUnifiedDiff, toHtml, toHunks } from './format.js';
