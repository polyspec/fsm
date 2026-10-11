#!/usr/bin/env node
// Checks that no tracked file names the library by its old name, `status` (`make name-check`; docs/plans/execution-checklist.md,
// S-18). Every tracked file and every tracked path is scanned for the word `status` in any case. An occurrence is a finding
// unless an entry of ALLOWED names it: the entry names the files, the line pattern and the reason. The library is named fsm
// (docs/plans/fsm-v1.md, R12). `status` stays where it names a state value, an exit status or a test result, or where a
// document keeps history.
//
//   node scripts/check-name.mjs [--root <dir>]
//
// Each finding is one line on standard error, `[check-name] <path>:<line>: <text>` (or `[check-name] <path>: ...` for a
// path); the command exits with status 1 when there is one, and 2 on a usage error.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './kit/glob.mjs';

const NAME = /status/i;

/**
 * The allowed occurrences. An entry allows an occurrence when its `files` globs match the path and, when it has a `match`
 * pattern, the pattern matches the line. An entry without `match` allows the whole file. Every entry has a reason.
 */
export const ALLOWED = Object.freeze([
  {
    files: ['scripts/kit/**', 'tests/kit/**', '.kit/kit.lock.json'],
    reason: 'the vendored kit: its files change only in the kit repository (AGENTS.md, Rules), and its lock records their digests',
  },
  {
    files: ['scripts/check-name.mjs', 'tests/check-name/**'],
    reason: 'the checker itself names the old name it searches for',
  },
  {
    files: ['CHANGELOG.md', 'CHANGELOG.ko.md'],
    reason: 'the bullets of finished items are history and keep their text; the S-18 bullet records the rename',
  },
  {
    files: ['docs/plans/execution-checklist.md', 'docs/plans/execution-checklist.ko.md'],
    match: /^\| S-18 \|/,
    reason: 'the S-18 row is the task text, which names the old name that the item renames',
  },
  {
    files: ['AGENTS.md', 'AGENTS.ko.md', 'docs/plans/fsm-v1.md', 'docs/plans/fsm-v1.ko.md'],
    match: /old name `status`|옛 이름 `status`/,
    reason: 'the rules and the plan state the rename and the name-check rule, which name the old name as such',
  },
  {
    files: ['.gitignore'],
    match: /config\.status$/,
    reason: 'the file config.status that autoconf writes when it configures the php-ext build (an ignored build output)',
  },
  {
    files: ['**'],
    match: /(?:get|set|Get|Set)_?Status\(|(?:get|set|Get|Set)_?status\(|\bstatusOf\b|\bStatusOf\b|(?:By|by_)Status\w*|(?:By|by_)status\w*|\bstatus i32\b|\bstatus column\b|the status column|the status code|status code|the status of the row/,
    reason: 'the consumer status column, a state value: its accessors (getStatus, setStatus, statusOf, orderByStatus) and its name in the persistence examples and docs',
  },
  {
    files: ['packages/*/examples/model/**'],
    match: /^(?!.*Polyspec\\).*/,
    reason: 'the model that orm-gen writes from schema/persist.dbs: its helpers are named after the status column (a state value)',
  },
  {
    files: ['**'],
    match: /\.status(?![.\w-])|\bstatus(?:: | !== | === )(?:'|\d|0)|\bstatus: (?=\w+\.status\b)|\bstatus \d+\b|\bexits? with status\b|\bstatus but pass\b|\bstatusFindings\b|\bgit status\b|\bstatus \$\{response|\{id, status, elapsedMs\}|status other than `pass`/,
    reason: 'an exit status, an HTTP response status or a test result status (pass, fail, skip, timeout) of a process, a request or a test, not the library',
  },
]);
/** The occurrences of the old name in `text` as { line, text }, each line once per occurrence kind. */
function scanText(file, text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!NAME.test(line)) return;
    const allowed = ALLOWED.some(entry => matchesAny(entry.files, file) && (entry.match === undefined || entry.match.test(line)));
    if (!allowed) findings.push({ file, line: index + 1, text: line.trim().slice(0, 160) });
  });
  return findings;
}

/** The tracked files of the checkout under `root`, as paths with `/` separators. */
function trackedPaths(root) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-files failed in ${root}: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean).sort();
}

/** The findings of every tracked file and path under `root`. */
export function nameFindings(root) {
  const findings = [];
  for (const file of trackedPaths(root)) {
    if (NAME.test(file) && !ALLOWED.some(entry => entry.match === undefined && matchesAny(entry.files, file))) {
      findings.push({ file, line: 0, text: 'the path names the library by its old name' });
    }
    const bytes = readFileSync(path.join(root, file));
    if (bytes.includes(0)) continue;
    findings.push(...scanText(file, bytes.toString('utf8')));
  }
  return findings;
}

function main(argv) {
  let options;
  try {
    options = parseArgs({ args: argv, options: { root: { type: 'string' } }, strict: true }).values;
  } catch (error) {
    process.stderr.write(`usage: check-name.mjs [--root <dir>] (${error.message})\n`);
    return 2;
  }
  const root = path.resolve(options.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const findings = nameFindings(root);
  for (const finding of findings) {
    const where = finding.line === 0 ? finding.file : `${finding.file}:${finding.line}`;
    process.stderr.write(`[check-name] ${where}: ${finding.text}\n`);
  }
  if (findings.length > 0) {
    process.stderr.write(`[check-name] ${findings.length} occurrence(s) of the old library name\n`);
    return 1;
  }
  process.stdout.write('[check-name] no occurrence of the old library name\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
