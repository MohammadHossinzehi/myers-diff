# myers-diff

A from-scratch implementation of Myers' O(ND) diff algorithm (E. Myers, "An O(ND) Difference Algorithm and Its Variations", 1986) in plain JavaScript, no dependencies. It computes the shortest edit script between two sequences and renders it as a unified diff, a colorized terminal diff, or an HTML view with inline word-level highlighting.

## What it does and why it's useful

Most people never see how `diff` actually decides what changed between two files. It is not a simple line-by-line comparison: it searches for the *shortest* sequence of insertions and deletions that turns one text into the other, treating the problem as a shortest path search through an edit graph. That search is what Myers' algorithm does, in O(ND) time where N and M are the input lengths and D is the size of the edit script, which is why `diff` stays fast even on large files that are mostly similar.

This repo implements that search from first principles, on top of a single generic function, `diffArray(a, b)`, that works on any array of comparable tokens. Line diffs, word diffs, and character diffs are all just different tokenizers feeding the same core algorithm:

- `diffLines(a, b)` — line-level diff, the basis for the unified diff / CLI output.
- `diffWords(a, b)` — word-level diff, used to highlight exactly which words changed inside a modified line.
- `diffChars(a, b)` — character-level diff.

On top of that there's a unified-diff formatter (`toUnifiedDiff`, the same format `diff -u` and `git diff` produce), a colorized terminal version for the CLI, and an HTML formatter that pairs up replaced lines and word-diffs them for inline highlighting, similar to how GitHub renders a single-line edit.

## How to run it

Requires Node.js 18+. No install step, no dependencies.

```bash
# Run the test suite (17 tests: algorithm correctness, round-trip fuzzing,
# hunk formatting, HTML rendering)
node --test test/

# Diff two files from the command line, unified-diff style with color
node bin/cli.js path/to/old.txt path/to/new.txt
```

Example:

```
$ node bin/cli.js a.txt b.txt
--- a.txt
+++ b.txt
@@ -1,5 +1,5 @@
 line one
-line two
+line TWO changed
 line three
 line four
-line five
+line five extra
```

The CLI exits with code `1` if differences were found and `0` if the files are identical, matching the convention of the standard `diff` tool.

### Interactive demo

`demo/index.html` is a self-contained browser page: two text boxes, a diff button, and a live inline diff view with word-level highlighting. It imports `src/diff.js` and `src/format.js` directly as ES modules, so it needs to be served over HTTP (browsers block ES module imports from `file://`):

```bash
npx serve .
# or: python3 -m http.server
```

then open `http://localhost:<port>/demo/`.

### Using it as a library

```js
import { diffLines } from './src/diff.js';
import { toUnifiedDiff, toHtml } from './src/format.js';

const ops = diffLines(oldText, newText);
console.log(toUnifiedDiff(ops, 'old.txt', 'new.txt'));
// or, in a browser: someElement.innerHTML = toHtml(ops);
```

`diffArray` returns an ordered list of `{ type: 'equal' | 'insert' | 'delete', value }` operations. `applyDiff(ops)` reconstructs both the original and modified text from that list, which the test suite uses to prove correctness (see below) rather than just eyeballing sample output.

## Design decisions

**Generic core, thin tokenizers on top.** `diffArray` has no idea whether it's diffing lines, words, or characters — it just compares array elements with `===`. This keeps the actual algorithm implementation small and lets `diffLines`/`diffWords`/`diffChars` all reuse it and stay trivial (split the string, call `diffArray`).

**The greedy forward search, not the recursive divide-and-conquer variant.** Myers' paper describes both a basic O(ND) greedy algorithm and a linear-space divide-and-conquer refinement (used by GNU diff) that trades some speed for O(N) memory. This implementation uses the basic greedy version with full trace history, which is simpler to implement correctly and easier to read, at the cost of O(D²) memory for the trace. That trade-off is fine for the text sizes this tool targets (source files, not multi-gigabyte logs).

**Runs of the same op type get merged (`mergeAdjacent`).** The raw backtrack produces one op per matched/inserted/deleted token; merging adjacent same-type ops into a single `{type, value}` both shrinks the output and makes it directly usable for line-based rendering, since a run of "delete" tokens becomes one deletable block instead of dozens of one-character ops.

**Word-level highlighting pairs replaced lines positionally, not by further Myers-diffing the two blocks as line arrays.** When a deleted block is immediately followed by an inserted block, `toHtml` zips their lines together by index and word-diffs each pair. This mirrors what `git diff --color-words` visually approximates and is far cheaper than running a second diff pass to decide which deleted line "belongs" with which inserted line — a decision that has no single correct answer anyway.

**Unified diff hunks use a prefix-count approach for line numbers.** `toHunks` computes, for every line, how many "before" and "after" lines came strictly before it, then derives each hunk's `@@ -start,count +start,count @@` header from a subtraction on that prefix table. This avoids the classic off-by-one bugs that come from trying to track running line counters through hunks that can start or end on an insert-only or delete-only line.

## Testing

`test/diff.test.js` (17 tests, using Node's built-in `node:test`, no test framework dependency) covers:

- **A known answer key**: the worked example from Myers' 1986 paper (`A = "ABCABBA"`, `B = "CBABAC"`) has a published shortest edit distance of 5, and the test asserts the algorithm finds exactly that — not just *a* correct script, but a *minimal* one.
- **Round-trip fuzzing**: 200 random character-level string pairs and 100 random multi-line documents are diffed, and `applyDiff` is used to reconstruct both the original and modified text from the resulting ops and assert they match exactly. This catches backtracking bugs that hand-picked examples would miss — an off-by-one in the trace reconstruction tends to only surface on specific input shapes, and random seeded fuzzing is far more likely to hit one than a handful of curated cases.
- **Edge cases**: empty inputs, identical inputs, pure insert, pure delete.
- **Formatting correctness**: unified diff hunk headers' `count` fields are checked against the actual number of lines in each hunk, and hunk merging/splitting behavior (nearby edits merge into one hunk, distant edits stay separate) is verified directly.
- **HTML output**: word-level `<mark>` wrapping on replaced lines, and HTML-escaping of special characters.

## Project layout

```
src/
  diff.js     the Myers algorithm itself, plus diffLines/diffWords/diffChars and applyDiff
  format.js   unified diff, colorized terminal diff, and HTML rendering
  index.js    public exports
bin/
  cli.js      command-line diff tool
demo/
  index.html  interactive browser demo
test/
  diff.test.js
```
