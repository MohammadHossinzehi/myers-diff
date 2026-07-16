import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffArray,
  diffChars,
  diffLines,
  diffWords,
  applyDiff,
  splitLines,
  splitWords,
} from '../src/diff.js';
import { toUnifiedDiff, toHunks, toHtml } from '../src/format.js';

function opCount(ops, type) {
  return ops.filter((o) => o.type === type).length;
}

// Total number of single-token edits (insert/delete tokens) implied by an
// op list. Used to check the algorithm actually finds the minimum, not
// just *a* valid edit script.
function editDistance(ops) {
  let d = 0;
  for (const op of ops) {
    if (op.type !== 'equal') d += op.value.length;
  }
  return d;
}

describe('diffArray core', () => {
  test('identical arrays produce a single equal op', () => {
    const ops = diffArray(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.deepEqual(ops, [{ type: 'equal', value: 'abc' }]);
  });

  test('empty vs empty produces no ops', () => {
    assert.deepEqual(diffArray([], []), []);
  });

  test('empty a is a pure insert', () => {
    const ops = diffArray([], ['x', 'y']);
    assert.deepEqual(ops, [{ type: 'insert', value: 'xy' }]);
  });

  test('empty b is a pure delete', () => {
    const ops = diffArray(['x', 'y'], []);
    assert.deepEqual(ops, [{ type: 'delete', value: 'xy' }]);
  });

  test('completely disjoint arrays', () => {
    const ops = diffArray(['a', 'b'], ['c', 'd']);
    assert.equal(opCount(ops, 'equal'), 0);
    assert.equal(applyDiff(ops).before, 'ab');
    assert.equal(applyDiff(ops).after, 'cd');
  });

  // The worked example from Myers' original 1986 paper (section on the
  // greedy algorithm): A = "ABCABBA", B = "CBABAC". The paper derives a
  // shortest edit script of length D = 5. This is the closest thing this
  // algorithm has to an authoritative external answer key.
  test('matches the shortest edit distance from the Myers 1986 paper example', () => {
    const a = Array.from('ABCABBA');
    const b = Array.from('CBABAC');
    const ops = diffArray(a, b);
    assert.equal(editDistance(ops), 5);
    assert.equal(applyDiff(ops).before, a.join(''));
    assert.equal(applyDiff(ops).after, b.join(''));
  });

  test('single substitution in the middle', () => {
    const ops = diffArray(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'X', 'd', 'e']);
    assert.equal(applyDiff(ops).before, 'abcde');
    assert.equal(applyDiff(ops).after, 'abXde');
    // The minimal script here is delete c / insert X, i.e. edit distance 2.
    assert.equal(editDistance(ops), 2);
  });
});

describe('round trip correctness (fuzz)', () => {
  function randomString(rng, alphabet, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
    return s;
  }

  // Deterministic seeded PRNG (mulberry32) so failures are reproducible.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('applyDiff(diffChars(a, b)) reconstructs both a and b for 200 random string pairs', () => {
    const rng = mulberry32(42);
    const alphabet = 'ab'; // small alphabet maximizes overlap/collisions, stress-testing the backtrack
    for (let i = 0; i < 200; i++) {
      const a = randomString(rng, alphabet, Math.floor(rng() * 20));
      const b = randomString(rng, alphabet, Math.floor(rng() * 20));
      const ops = diffChars(a, b);
      const { before, after } = applyDiff(ops);
      assert.equal(before, a, `before mismatch for a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
      assert.equal(after, b, `after mismatch for a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
    }
  });

  test('applyDiff(diffLines(a, b)) round-trips multi-line documents', () => {
    const rng = mulberry32(7);
    const words = ['foo', 'bar', 'baz', 'qux', 'quux'];
    function randomDoc() {
      const n = 1 + Math.floor(rng() * 8);
      const lines = [];
      for (let i = 0; i < n; i++) lines.push(words[Math.floor(rng() * words.length)]);
      return lines.join('\n') + (rng() > 0.5 ? '\n' : '');
    }
    for (let i = 0; i < 100; i++) {
      const a = randomDoc();
      const b = randomDoc();
      const ops = diffLines(a, b);
      const { before, after } = applyDiff(ops);
      assert.equal(before, a);
      assert.equal(after, b);
    }
  });
});

describe('tokenizers', () => {
  test('splitLines keeps newlines attached to their line', () => {
    assert.deepEqual(splitLines('a\nb\nc'), ['a\n', 'b\n', 'c']);
    assert.deepEqual(splitLines('a\nb\n'), ['a\n', 'b\n']);
    assert.deepEqual(splitLines(''), []);
  });

  test('splitWords round-trips by concatenation', () => {
    const text = 'the quick  brown fox\tjumps';
    assert.equal(splitWords(text).join(''), text);
  });

  test('diffWords highlights only the changed word', () => {
    const ops = diffWords('the quick brown fox', 'the quick red fox');
    const deleted = ops.filter((o) => o.type === 'delete').map((o) => o.value.trim());
    const inserted = ops.filter((o) => o.type === 'insert').map((o) => o.value.trim());
    assert.deepEqual(deleted, ['brown']);
    assert.deepEqual(inserted, ['red']);
  });
});

describe('unified diff formatting', () => {
  test('no differences produces an empty diff', () => {
    const ops = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    assert.equal(toUnifiedDiff(ops), '');
  });

  test('unified diff hunk header line counts match actual hunk contents', () => {
    const a = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n') + '\n';
    const bLines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    bLines[5] = 'CHANGED';
    const b = bLines.join('\n') + '\n';

    const ops = diffLines(a, b);
    const hunks = toHunks(ops, 3);
    assert.equal(hunks.length, 1);
    const hunk = hunks[0];

    const aLinesInHunk = hunk.lines.filter((l) => l.type !== 'insert').length;
    const bLinesInHunk = hunk.lines.filter((l) => l.type !== 'delete').length;
    assert.equal(hunk.countA, aLinesInHunk);
    assert.equal(hunk.countB, bLinesInHunk);

    const text = toUnifiedDiff(ops, 'a.txt', 'b.txt');
    assert.match(text, /^--- a\.txt\n\+\+\+ b\.txt\n@@ /);
  });

  test('distant edits produce separate hunks; nearby edits merge into one', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const a = lines.join('\n') + '\n';
    const near = [...lines];
    near[10] = 'X';
    near[12] = 'Y'; // within 2*context (default 3) of the first change -> should merge
    const bNear = near.join('\n') + '\n';
    assert.equal(toHunks(diffLines(a, bNear)).length, 1);

    const far = [...lines];
    far[2] = 'X';
    far[35] = 'Y'; // far apart -> should stay as two hunks
    const bFar = far.join('\n') + '\n';
    assert.equal(toHunks(diffLines(a, bFar)).length, 2);
  });
});

describe('HTML formatting', () => {
  test('wraps a replaced line pair with word-level <mark> highlights', () => {
    const ops = diffLines('hello world\n', 'hello there\n');
    const html = toHtml(ops);
    assert.match(html, /del-line/);
    assert.match(html, /ins-line/);
    assert.match(html, /<mark class="del">world<\/mark>/);
    assert.match(html, /<mark class="ins">there<\/mark>/);
  });

  test('escapes HTML-significant characters', () => {
    const ops = diffLines('a\n', '<script>&\n');
    const html = toHtml(ops);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});
