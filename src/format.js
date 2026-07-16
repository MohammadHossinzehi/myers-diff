// src/format.js
//
// Rendering helpers built on top of diff.js: a classic unified-diff text
// formatter (the format `diff -u` and `git diff` use) and an HTML
// formatter for the browser demo, with word-level highlighting inside
// changed lines.

import { diffWords } from './diff.js';

/**
 * Expands a merged line-diff op list (from diffLines) back into one entry
 * per physical line, tagged with its type.
 *
 * @param {import('./diff.js').DiffOp[]} ops
 * @returns {{type: string, value: string}[]}
 */
function expandLines(ops) {
  const lines = [];
  for (const op of ops) {
    if (op.value.length === 0) continue;
    const parts = op.value.split(/(?<=\n)/).filter(Boolean);
    for (const part of parts) lines.push({ type: op.type, value: part });
  }
  return lines;
}

/**
 * Groups a flat line-diff op list into unified-diff style hunks, each
 * padded with up to `context` lines of surrounding unchanged content.
 * Nearby changes (gap <= 2*context) are merged into a single hunk, which
 * is what keeps unified diffs of large files with scattered edits short.
 *
 * @param {import('./diff.js').DiffOp[]} ops
 * @param {number} context
 * @returns {{lines: {type: string, value: string}[], startA: number, countA: number, startB: number, countB: number}[]}
 */
export function toHunks(ops, context = 3) {
  const lines = expandLines(ops);
  if (lines.length === 0) return [];

  // Prefix counts of how many a-lines / b-lines occur strictly before
  // index i. This makes hunk line numbers a simple subtraction, whatever
  // mix of equal/insert/delete lines the hunk happens to start or end on.
  const aBefore = [0];
  const bBefore = [0];
  for (const line of lines) {
    aBefore.push(aBefore[aBefore.length - 1] + (line.type !== 'insert' ? 1 : 0));
    bBefore.push(bBefore[bBefore.length - 1] + (line.type !== 'delete' ? 1 : 0));
  }

  const changedIdx = [];
  lines.forEach((l, i) => {
    if (l.type !== 'equal') changedIdx.push(i);
  });
  if (changedIdx.length === 0) return [];

  // Merge changes that are within 2*context lines of each other into one
  // cluster, so their padding regions overlap into a single hunk.
  const clusters = [[changedIdx[0], changedIdx[0]]];
  for (let i = 1; i < changedIdx.length; i++) {
    const idx = changedIdx[i];
    const last = clusters[clusters.length - 1];
    if (idx - last[1] <= 2 * context) {
      last[1] = idx;
    } else {
      clusters.push([idx, idx]);
    }
  }

  return clusters.map(([s, e]) => {
    const from = Math.max(0, s - context);
    const to = Math.min(lines.length - 1, e + context);
    return {
      lines: lines.slice(from, to + 1),
      startA: aBefore[from] + 1,
      countA: aBefore[to + 1] - aBefore[from],
      startB: bBefore[from] + 1,
      countB: bBefore[to + 1] - bBefore[from],
    };
  });
}

/**
 * Renders a line-diff op list as a classic unified diff (like `diff -u`).
 *
 * @param {import('./diff.js').DiffOp[]} ops
 * @param {string} labelA
 * @param {string} labelB
 * @returns {string}
 */
export function toUnifiedDiff(ops, labelA = 'a', labelB = 'b') {
  const hunks = toHunks(ops);
  if (hunks.length === 0) return '';

  const out = [`--- ${labelA}`, `+++ ${labelB}`];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.startA},${hunk.countA} +${hunk.startB},${hunk.countB} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
      out.push(prefix + line.value.replace(/\n$/, ''));
    }
  }
  return out.join('\n');
}

const ANSI = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' };

/**
 * Same as toUnifiedDiff but with ANSI color codes, for terminal output.
 * @param {import('./diff.js').DiffOp[]} ops
 * @param {string} labelA
 * @param {string} labelB
 */
export function toColorUnifiedDiff(ops, labelA = 'a', labelB = 'b') {
  return toUnifiedDiff(ops, labelA, labelB)
    .split('\n')
    .map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) return ANSI.green + line + ANSI.reset;
      if (line.startsWith('-') && !line.startsWith('---')) return ANSI.red + line + ANSI.reset;
      if (line.startsWith('@@')) return ANSI.dim + line + ANSI.reset;
      return line;
    })
    .join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders a line-diff as an HTML string with inline word-level
 * highlighting: when a deleted line is immediately followed by an
 * inserted line (a "replace" pair), the two are word-diffed against each
 * other so only the changed words are highlighted, matching the way
 * GitHub's diff view renders single-line edits.
 *
 * @param {import('./diff.js').DiffOp[]} ops
 * @returns {string}
 */
function splitToLines(value) {
  const lines = value.split(/\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Word-diffs one deleted line against one inserted line and renders both
// as a del/ins row pair with only the changed words marked.
function renderReplacedLinePair(delLine, insLine, rows) {
  const wordOps = diffWords(delLine, insLine);
  const delHtml = wordOps
    .filter((w) => w.type !== 'insert')
    .map((w) => (w.type === 'delete' ? `<mark class="del">${escapeHtml(w.value)}</mark>` : escapeHtml(w.value)))
    .join('');
  const insHtml = wordOps
    .filter((w) => w.type !== 'delete')
    .map((w) => (w.type === 'insert' ? `<mark class="ins">${escapeHtml(w.value)}</mark>` : escapeHtml(w.value)))
    .join('');
  rows.push(`<div class="line del-line">-${delHtml}</div>`);
  rows.push(`<div class="line ins-line">+${insHtml}</div>`);
}

export function toHtml(ops) {
  const rows = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const next = ops[i + 1];

    if (op.type === 'delete' && next && next.type === 'insert') {
      // A delete immediately followed by an insert is rendered as a
      // "replace": pair up lines 1:1 (in order) and word-diff each pair
      // for inline highlighting, the way GitHub's split/inline diff view
      // does for single-line edits. Any leftover lines on the longer side
      // fall back to plain delete/insert rows.
      const delLines = splitToLines(op.value);
      const insLines = splitToLines(next.value);
      const pairCount = Math.min(delLines.length, insLines.length);

      for (let p = 0; p < pairCount; p++) {
        renderReplacedLinePair(delLines[p], insLines[p], rows);
      }
      for (let p = pairCount; p < delLines.length; p++) {
        rows.push(`<div class="line del-line">-${escapeHtml(delLines[p])}</div>`);
      }
      for (let p = pairCount; p < insLines.length; p++) {
        rows.push(`<div class="line ins-line">+${escapeHtml(insLines[p])}</div>`);
      }

      i++; // consumed `next` as well
      continue;
    }

    const prefix = op.type === 'insert' ? '+' : op.type === 'delete' ? '-' : '&nbsp;';
    const cls = op.type === 'insert' ? 'ins-line' : op.type === 'delete' ? 'del-line' : 'eq-line';
    for (const line of splitToLines(op.value)) {
      rows.push(`<div class="line ${cls}">${prefix}${escapeHtml(line)}</div>`);
    }
  }
  return rows.join('\n');
}
