#!/usr/bin/env node
// Checks that no tracked document names a Git commit, of this repository or of another (AGENTS.md, "Rules"): a release and a
// lock pin the name of a commit, and a name written in a document is a wrong value once the history changes.
//
//   node scripts/check-commit-names.mts
//
// A commit name is a word of 7 to 40 lowercase hexadecimal digits that holds a digit and a letter and that no letter, digit,
// `_`, `-`, `/`, `:`, `=`, `@` or `#` touches and no `.` joins to another word, so a digest of 64 digits, a number, a path and
// an identifier are none. The
// documents are the tracked `*.md` files. Each finding is one line on standard error, `<file>:<line>: <name>`, and the command
// exits with status 1 when there is one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WORD = /(?<![0-9A-Za-z_\-/.:=@#])[0-9a-f]{7,40}(?![0-9A-Za-z_\-/:=@#]|\.[0-9A-Za-z])/g;

/** One commit name of a tracked document: the file, its line from 1 and the name. */
export interface CommitName {
  file: string;
  line: number;
  name: string;
}

/** The commit names of the line `line`. */
export function commitNames(line: string): string[] {
  return (line.match(WORD) ?? []).filter(word => /[0-9]/.test(word) && /[a-f]/.test(word));
}

/** The commit names of the tracked documents of the checkout `root`, in the order of the files and their lines. */
export function findings(root: string): CommitName[] {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.md'], { encoding: 'utf8' }).split('\0').filter(file => file !== '').sort();
  const found: CommitName[] = [];
  for (const file of files) {
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, index) => {
      for (const name of commitNames(text)) found.push({ file, line: index + 1, name });
    });
  }
  return found;
}

if (import.meta.main) {
  const found = findings(resolve(import.meta.dirname, '..'));
  for (const { file, line, name } of found) process.stderr.write(`${file}:${String(line)}: ${name}\n`);
  if (found.length > 0) {
    process.stderr.write(`check-commit-names: ${String(found.length)} commit names in the tracked documents; a document names no Git commit\n`);
    process.exit(1);
  }
  process.stdout.write('check-commit-names: no tracked document names a Git commit\n');
}
