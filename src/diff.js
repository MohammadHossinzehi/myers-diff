// src/diff.js
//
// From scratch implementation of Myers' O(ND) diff algorithm
// (E. Myers, "An O(ND) Difference Algorithm and Its Variations", 1986).
//
// diffArray finds the Shortest Edit Script (SES) between two arbitrary
// arrays of comparable tokens (strings, in practice) by greedily searching
// "D paths" through the edit graph one furthest reaching diagonal at a
// time, then backtracking through the recorded search history to
// reconstruct the actual sequence of edits. diffLines, diffWords and
// diffChars are thin tokenizers on top of that: split the input into an
// array of tokens and hand it to diffArray.

/**
 * @typedef {{ type: 'equal' | 'insert' | 'delete', value: string }} DiffOp
 */

/**
 * Computes the shortest edit script that transforms array `a` into array `b`.
 * Returns an ordered list of equal / delete / insert operations that, when
 * applied to `a`, reconstruct `b` exactly (see applyDiff).
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {DiffOp[]}
 */
export function diffArray(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  const trace = [];
  // v[k] holds the x coordinate of the furthest reaching point reached on
  // diagonal k = x - y using the fewest edits found so far this round.
  let v = new Map([[1, 0]]);

  let finalD = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v);
    const nextV = new Map(v);

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))) {
        x = v.get(k + 1); // descended from diagonal k+1: a vertical move (insert)
      } else {
        x = v.get(k - 1) + 1; // descended from diagonal k-1: a horizontal move (delete)
      }
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      nextV.set(k, x);

      if (x >= n && y >= m) {
        v = nextV;
        finalD = d;
        break outer;
      }
    }
    v = nextV;
  }

  return backtrack(trace, a, b, finalD);
}

function backtrack(trace, a, b, finalD) {
  const ops = [];
  let x = a.length;
  let y = b.length;

  for (let d = finalD; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v.get(prevK);
    const prevY = prevX - prevK;

    // Walk back along the free diagonal (the run of matches) first.
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', value: a[x - 1] });
      x--;
      y--;
    }

    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'insert', value: b[y - 1] });
      } else {
        ops.push({ type: 'delete', value: a[x - 1] });
      }
    }

    x = prevX;
    y = prevY;
  }

  ops.reverse();
  return mergeAdjacent(ops);
}

// Collapse runs of the same op type into a single op, which is both a
// minor size optimization and much easier to render as diff hunks.
function mergeAdjacent(ops) {
  const merged = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.value += op.value;
    } else {
      merged.push({ type: op.type, value: op.value });
    }
  }
  return merged;
}

/**
 * Reconstructs the "before" and "after" sequences by applying a diff
 * script. Used by the test suite to prove round trip correctness rather
 * than trusting hand picked examples alone.
 *
 * @param {DiffOp[]} ops
 * @returns {{ before: string, after: string }}
 */
export function applyDiff(ops) {
  let before = '';
  let after = '';
  for (const op of ops) {
    if (op.type === 'equal') {
      before += op.value;
      after += op.value;
    } else if (op.type === 'delete') {
      before += op.value;
    } else if (op.type === 'insert') {
      after += op.value;
    }
  }
  return { before, after };
}

/**
 * Splits text into lines, keeping the trailing newline attached to each
 * line (except possibly the last) so that a missing trailing newline shows
 * up as a real diff, the same way `diff` and `git diff` treat it.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (text === '') return [];
  return text.split(/(?<=\n)/);
}

/**
 * Line level diff between two texts.
 * @param {string} a
 * @param {string} b
 * @returns {DiffOp[]}
 */
export function diffLines(a, b) {
  return diffArray(splitLines(a), splitLines(b));
}

/**
 * Splits text into words and the whitespace/punctuation runs between them,
 * so that re-joining every token reproduces the original string exactly.
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  if (text === '') return [];
  return text.match(/\s+|[^\s]+/g) || [];
}

/**
 * Word level diff, typically used to highlight the changed portion of a
 * single replaced line.
 * @param {string} a
 * @param {string} b
 * @returns {DiffOp[]}
 */
export function diffWords(a, b) {
  return diffArray(splitWords(a), splitWords(b));
}

/**
 * Character level diff.
 * @param {string} a
 * @param {string} b
 * @returns {DiffOp[]}
 */
export function diffChars(a, b) {
  return diffArray(Array.from(a), Array.from(b));
}
