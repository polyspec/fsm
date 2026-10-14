#!/usr/bin/env node
// Checks that no tracked file names the library by its old name, `status` (`make name-check`; docs/plans/execution-checklist.md,
// S-18 and S-27). Every tracked file and every tracked path is scanned for the word `status` in any case, occurrence by
// occurrence: for each line that contains the word, the spans that an entry of ALLOWED names (for the file) are removed from
// the line, and the rest of the line is scanned again. A word left over is a finding. An entry without `match` allows the
// whole file. The library is named fsm (docs/plans/fsm-v1.md, R12). `status` stays where it names a state value, an exit
// status or a test result, or where a document keeps history.
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
import kitPackage from '@polyspec/kit/package.json' with { type: 'json' };
import picomatch from 'picomatch';

const NAME = /status/i;

/**
 * The allowed occurrences. An entry applies to the files its `files` globs match. Without `match` it allows the whole file;
 * with `match` it allows the spans that the pattern matches in each line (a pattern that matches a whole line allows the
 * whole line). Every entry has a reason; the phrases are exact, so a word next to an allowed phrase stays a finding.
 */
export const ALLOWED = Object.freeze([
  {
    files: Object.keys(kitPackage.kit.copies),
    reason: 'the copies of kit (kit.copies of the installed @polyspec/kit): they change only in the kit repository (AGENTS.md, Rules)',
  },
  {
    files: ['scripts/check-name.mjs', 'tests/check-name/**'],
    reason: 'the checker and its tests name the old name as the thing they check, and their fixtures are built in temporary directories',
  },
  {
    files: ['CHANGELOG.md', 'CHANGELOG.ko.md'],
    match: /^- S-(?:(?:0\d|1[0-7])(?:-\d+)?|18): .*$/,
    reason: 'the bullets of the items up to the rename (S-01 to S-18) are history and keep the names they had; S-18 records the rename',
  },
  {
    files: ['CHANGELOG.md', 'CHANGELOG.ko.md'],
    match: /`docs\/spec\/status\.md`, B-1\)/,
    reason: 'the S-05 group has an unlabelled bullet that names the spec path it was written with, before the rename',
  },
  {
    files: ['docs/plans/execution-checklist.md', 'docs/plans/execution-checklist.ko.md'],
    match: /Rename status to fsm everywhere|a remaining `status` name that is not a state status|status를 fsm으로 전부 바꾼다|상태 의미가 아닌 `status` 이름이 남으면/,
    reason: 'the S-18 row is the task text: its phrases name the old name that the item renames and the scan it asks for',
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
    match: /\b(?:[Gg]et|[Ss]et|[Gg]roupBy|[Oo]rderBy|group_by|order_by)_?[Ss]tatus(?:_?(?:[Aa]sc|[Dd]esc))?\b|\b[Ss]tatusOf\b|\bstatus_of\b|\bstatus i32\b|\bstatus column\b|\bstatus code\b|\bstatus of the row\b/,
    reason: 'the consumer status column, a state value: its accessors (getStatus, setStatus, orderByStatusAsc), statusOf and status_of, and the column words of the persistence examples and docs',
  },
  {
    files: ['packages/*/examples/model/**'],
    match: /\b(?:[Aa]dd_?[Cc]olumn|[Rr]emove_?[Cc]olumn|[Kk]ey_?[Nn]ame|[Pp]lus|[Mm]inus|[Ss]um|[Aa]vg|[Gg]roup_?[Bb]y|[Oo]rder_?[Bb]y|[Gg]et|[Ss]et|f)_?[Ss]tatus(?:_?(?:[Aa]sc|[Dd]esc))?\b|(['"])status\1|\bcolumn status:|\b(?:returns|sets) status\.|\bstatus: int\./,
    reason: 'the model that orm-gen writes from schema/persist.dbs: its helpers are named after the status column, and its column name and doc comments say so',
  },
  {
    files: ['**'],
    match: /\.status(?![.\w-])|\bstatus(?:: | !== | === )(?:'|\d|0)|\bstatus: (?=\w+\.status\b)|\bstatus \d+\b|\bexits? with status\b|\bstatus but pass\b|\bstatusFindings\b|\bgit status\b|\bstatus \$\{response|\{id, status, elapsedMs\}|status other than `pass`|\breturns its status, stdout and stderr\b|\breturns its status and stderr\b/,
    reason: 'an exit status, an HTTP response status or a test result status (pass, fail, skip, timeout) of a process, a request or a test, not the library',
  },
]);

/** Whether `file` matches one of `globs`; `*` and `**` match dot files too. */
const matchesAny = (globs, file) => picomatch.isMatch(file, globs, { dot: true });

/** The global form of an entry pattern, so that every span of a line is removed. */
function globalOf(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

/** The findings of `text`: the lines of `file` that still hold the word after its allowed spans are removed. */
function scanText(file, text) {
  const findings = [];
  const entries = ALLOWED.filter(entry => matchesAny(entry.files, file));
  if (entries.some(entry => entry.match === undefined)) return findings;
  const patterns = entries.map(entry => globalOf(entry.match));
  text.split('\n').forEach((line, index) => {
    if (!NAME.test(line)) return;
    let rest = line;
    for (const pattern of patterns) rest = rest.replace(pattern, ' ');
    if (NAME.test(rest)) findings.push({ file, line: index + 1, text: line.trim().slice(0, 160) });
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
