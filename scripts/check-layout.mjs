#!/usr/bin/env node
// Checks the canonical layout of the language packages against contracts/layout.json (`make layout-check`):
//
//   layout-config    contracts/layout.json exists and matches the schema below; a kind is one of the six targets and
//                    names the generated globs of its package (the files that gen-check compares)
//   layout-kinds     the directories of packages/ are exactly the tools and the kinds (packages/fsm-<kind>)
//   layout-file      every file of a kind package matches a canonical file, a required file or an allowed glob of the kind
//   layout-missing   every canonical file and every required file of the kind exists, and every canonical directory holds a file
//   layout-php-twin  the php and the php-ext packages hold the same tests/ files with the same bytes
//   layout-config    also: a test file of an allowed glob (tests/...) beyond the required set is a difference, which must be
//                    declared in `differences` with its reason; a declared difference names an allowed glob of its kind
//
//   node scripts/check-layout.mjs
//
// The files are the tracked files and the new files that Git does not ignore (scripts/kit/tracked-files.mjs), so ignored
// build output never counts and a stray untracked file does. Each finding is one line `<rule>: <message>` on standard error;
// the command exits with status 1 when there is one.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globExpression } from './kit/glob.mjs';
import { isMain } from './kit/paths.mjs';
import { validate } from './kit/schema-validate.mjs';
import { trackedFiles } from './kit/tracked-files.mjs';

export const LAYOUT = 'contracts/layout.json';
export const KINDS = ['go', 'npm', 'php', 'php-ext', 'python', 'rust'];

const strings = { type: 'array', items: { type: 'string', pattern: '^[^/].*[^/]$' } };
const kindSchema = {
  type: 'object',
  required: ['required', 'allowed', 'generated'],
  additionalProperties: false,
  properties: { required: strings, allowed: strings, generated: strings },
};
const SCHEMA = {
  type: 'object',
  required: ['schema', 'tools', 'canonical', 'kinds'],
  additionalProperties: false,
  properties: {
    schema: { type: 'integer', const: 1 },
    comment: { type: 'string' },
    tools: { type: 'array', items: { type: 'string', pattern: '^fsm-[a-z][a-z-]*$' } },
    canonical: {
      type: 'object',
      required: ['files', 'directories'],
      additionalProperties: false,
      properties: { files: strings, directories: strings },
    },
    kinds: { type: 'object', additionalProperties: false, properties: Object.fromEntries(KINDS.map(kind => [kind, kindSchema])) },
    differences: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'path', 'reason'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: KINDS },
          path: { type: 'string', pattern: '^[^/].*[^/]$' },
          reason: { type: 'string', pattern: '\\S' },
        },
      },
    },
  },
};

const finding = (rule, message) => ({ rule, message });

/** The findings of the checkout `root` as `{ rule, message }`, in a stable order. */
export function layoutFindings(root) {
  const file = path.join(root, LAYOUT);
  if (!existsSync(file)) return [finding('layout-config', `${LAYOUT} does not exist; it declares the tools, the kinds and the canonical layout`)];
  let layout;
  try {
    layout = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return [finding('layout-config', `${LAYOUT} is not JSON: ${error.message}`)];
  }
  const errors = validate(layout, SCHEMA);
  if (errors.length) return errors.map(error => finding('layout-config', `${LAYOUT}: ${error}`));

  const files = trackedFiles(root).filter(entry => entry.startsWith('packages/'));
  const found = [];
  const packages = [...new Set(files.map(entry => entry.split('/')[1]))].sort();
  const kinds = Object.keys(layout.kinds).sort();
  const declared = new Set([...layout.tools, ...kinds.map(kind => `fsm-${kind}`)]);
  for (const name of packages.filter(entry => !declared.has(entry))) {
    found.push(finding('layout-kinds', `packages/${name} is neither a tool nor a kind of ${LAYOUT}; declare it or remove it`));
  }
  for (const kind of kinds.filter(entry => !packages.includes(`fsm-${entry}`))) {
    found.push(finding('layout-kinds', `the kind ${kind} has no package packages/fsm-${kind}`));
  }

  for (const kind of kinds.filter(entry => packages.includes(`fsm-${entry}`))) {
    const base = `packages/fsm-${kind}/`;
    const own = files.filter(entry => entry.startsWith(base)).map(entry => entry.slice(base.length));
    const rule = layout.kinds[kind];
    const exact = new Set([...layout.canonical.files, ...rule.required]);
    const globs = rule.allowed.map(globExpression);
    for (const entry of own.filter(entry => !exact.has(entry) && !globs.some(glob => glob.test(entry)))) {
      found.push(finding('layout-file', `${base}${entry} is not in the canonical layout of ${kind}; move it, rename it or declare it in ${LAYOUT}`));
    }
    for (const entry of [...exact].filter(entry => !own.includes(entry))) {
      found.push(finding('layout-missing', `${base}${entry} is missing; every ${kind} package has it`));
    }
    for (const directory of layout.canonical.directories.filter(entry => !own.some(name => name.startsWith(`${entry}/`)))) {
      found.push(finding('layout-missing', `${base}${directory}/ holds no file; every package has ${layout.canonical.directories.map(entry => `${entry}/`).join(', ').replace(/, ([^,]*)$/, ' and $1')}`));
    }
  }

  const differences = layout.differences ?? [];
  for (const kind of kinds) {
    for (const glob of layout.kinds[kind].allowed.filter(entry => entry.startsWith('tests/'))) {
      if (!differences.some(entry => entry.kind === kind && entry.path === glob)) {
        found.push(finding('layout-config', `${LAYOUT}: ${kind} allows ${glob}, a test beyond its required set; declare it in differences with its reason`));
      }
    }
  }
  for (const entry of differences) {
    if (!layout.kinds[entry.kind]?.allowed.includes(entry.path)) {
      found.push(finding('layout-config', `${LAYOUT}: the difference ${entry.kind} ${entry.path} is not an allowed glob of ${entry.kind}`));
    }
  }

  if (['php', 'php-ext'].every(kind => kinds.includes(kind) && packages.includes(`fsm-${kind}`))) {
    const tests = kind => files.filter(entry => entry.startsWith(`packages/fsm-${kind}/tests/`)).map(entry => entry.slice(`packages/fsm-${kind}/`.length));
    const php = tests('php');
    const ext = tests('php-ext');
    for (const entry of [...new Set([...php, ...ext])].sort()) {
      const a = php.includes(entry) ? readFileSync(path.join(root, 'packages/fsm-php', entry)) : null;
      const b = ext.includes(entry) ? readFileSync(path.join(root, 'packages/fsm-php-ext', entry)) : null;
      if (a === null || b === null || !a.equals(b)) {
        found.push(finding('layout-php-twin', `${entry} differs between packages/fsm-php and packages/fsm-php-ext; the two packages run the same tests`));
      }
    }
  }
  return found;
}

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`[check-layout] reading ${LAYOUT} and the packages of the checkout`);
  const found = layoutFindings(root);
  for (const entry of found) console.error(`[check-layout] ${entry.rule}: ${entry.message}`);
  if (found.length) {
    console.error(`[check-layout] ${found.length} findings`);
    process.exit(1);
  }
  console.log('[check-layout] the packages follow the canonical layout');
}
