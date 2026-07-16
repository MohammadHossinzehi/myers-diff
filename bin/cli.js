#!/usr/bin/env node
// bin/cli.js — command line unified diff, e.g.:
//   node bin/cli.js old.txt new.txt

import { readFileSync } from 'node:fs';
import { diffLines } from '../src/diff.js';
import { toColorUnifiedDiff } from '../src/format.js';

const [, , pathA, pathB] = process.argv;

if (!pathA || !pathB) {
  console.error('Usage: node bin/cli.js <fileA> <fileB>');
  process.exit(1);
}

let textA, textB;
try {
  textA = readFileSync(pathA, 'utf8');
  textB = readFileSync(pathB, 'utf8');
} catch (err) {
  console.error(`Could not read input files: ${err.message}`);
  process.exit(1);
}

const ops = diffLines(textA, textB);
const diffText = toColorUnifiedDiff(ops, pathA, pathB);

if (diffText === '') {
  console.log(`No differences between ${pathA} and ${pathB}`);
  process.exit(0);
}

console.log(diffText);
process.exit(1); // mirrors the conventional `diff` exit code: 1 means "differences found"
