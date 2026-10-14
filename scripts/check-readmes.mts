#!/usr/bin/env node
// Checks the user documentation of the library (`make readme-check`; docs/plans/fsm-v1.md, C-9, and docs/plans/execution-checklist.md,
// S-19). Every README pair declared in README_PAIRS has its English file, its Korean twin and every required section of its kind
// as an English `##` heading. A Korean twin has the same number of headings per level as its English file, so that the two stay
// the same document. Headings inside fenced code blocks are not sections.
//
//   node scripts/check-readmes.mts [--root <dir>]
//
// Each finding is one line on standard error, `[check-readmes] <path>: <message>`; the command exits with status 1 when there is
// one, and 2 on a usage error. The sections of each kind are the user's questions that the README answers (fsm-v1.md, R11).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const LANGUAGE_SECTIONS = Object.freeze([
  'Generate into your project',
  'Generated files',
  'API',
  'Errors',
  'Persistence',
  'Tests',
]);

/**
 * The README pairs of the repository. `en` is the canonical file, `ko` its twin, `sections` the English `##` headings the
 * English file must hold. Each pair is one kind: root, compiler, db, gui or language.
 */
export const README_PAIRS = Object.freeze([
  {
    kind: 'root',
    en: 'README.md',
    ko: 'README.ko.md',
    sections: [
      'What fsm is and is not',
      'The model',
      'Codes and the lock',
      'Transitions',
      'Validation errors',
      'Project files',
      'Requirements and setup',
      'The fsm-gen CLI',
      'The tools',
      'Generated names',
      'Checks',
    ],
  },
  {
    kind: 'compiler',
    en: 'packages/compiler/README.md',
    ko: 'packages/compiler/README.ko.md',
    sections: ['Architecture', 'The store contract', 'Commands', 'Backend options', 'Vectors'],
  },
  {
    kind: 'db',
    en: 'packages/db/README.md',
    ko: 'packages/db/README.ko.md',
    sections: [
      'What it is',
      'Set up',
      'The six tables',
      'DSN',
      'Commands',
      'Moving an existing json or mermaid project to the database',
      'Checks',
    ],
  },
  {
    kind: 'gui',
    en: 'packages/gui/README.md',
    ko: 'packages/gui/README.ko.md',
    sections: ['What it does', 'Setup', 'Running', 'Screens', 'Rules'],
  },
  ...['go', 'js', 'php', 'php-ext', 'python', 'rust'].map(folder => ({
    kind: 'language',
    en: `packages/${folder}/README.md`,
    ko: `packages/${folder}/README.ko.md`,
    sections: LANGUAGE_SECTIONS,
  })),
]);

/** The headings of a Markdown text as { level, text }, outside fenced code blocks. */
export function headings(text) {
  const result = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6}) (.+?)\s*$/.exec(line);
    if (match !== null) result.push({ level: match[1].length, text: match[2] });
  }
  return result;
}

/** The number of headings of each level, as a map of level to count. */
function countByLevel(list) {
  const counts = new Map();
  for (const { level } of list) counts.set(level, (counts.get(level) ?? 0) + 1);
  return counts;
}

/** The findings of one pair under `root`: { file, message } for each problem. */
function pairFindings(root, pair) {
  const findings = [];
  if (!existsSync(path.join(root, pair.en))) return [{ file: pair.en, message: 'the README is missing' }];
  if (!existsSync(path.join(root, pair.ko))) return [{ file: pair.ko, message: 'the Korean twin is missing' }];
  const english = headings(readFileSync(path.join(root, pair.en), 'utf8'));
  const korean = headings(readFileSync(path.join(root, pair.ko), 'utf8'));
  const present = new Set(english.filter(h => h.level === 2).map(h => h.text));
  for (const section of pair.sections) {
    if (!present.has(section)) findings.push({ file: pair.en, message: `missing section ## ${section}` });
  }
  const englishCounts = countByLevel(english);
  const koreanCounts = countByLevel(korean);
  const levels = [...new Set([...englishCounts.keys(), ...koreanCounts.keys()])].sort((a, b) => a - b);
  for (const level of levels) {
    const expected = englishCounts.get(level) ?? 0;
    const actual = koreanCounts.get(level) ?? 0;
    if (expected !== actual) {
      findings.push({
        file: pair.ko,
        message: `has ${actual} heading(s) of level ${level}, the English README has ${expected}`,
      });
    }
  }
  return findings;
}

/** The findings of every declared README pair under `root`. */
export function readmeFindings(root) {
  return README_PAIRS.flatMap(pair => pairFindings(root, pair));
}

function main(argv) {
  let options;
  try {
    options = parseArgs({ args: argv, options: { root: { type: 'string' } }, strict: true }).values;
  } catch (error) {
    process.stderr.write(`usage: check-readmes.mts [--root <dir>] (${error.message})\n`);
    return 2;
  }
  const root = path.resolve(options.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const findings = readmeFindings(root);
  for (const finding of findings) process.stderr.write(`[check-readmes] ${finding.file}: ${finding.message}\n`);
  if (findings.length > 0) {
    process.stderr.write(`[check-readmes] ${findings.length} finding(s) in the user documentation\n`);
    return 1;
  }
  process.stdout.write('[check-readmes] every README has its sections and its Korean twin\n');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
