// Tests of the documentation site (docs/.vitepress/config.mts, `make docs-build`; docs/plans/fsm-v1.md, C-8). The site is built
// from the repository documents in place. A broken link must fail the build, and the real build must produce the pages of the
// English and Korean root, a package and the link rewrite. Each broken case builds a copy of the repository documents and the
// site configuration in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITEPRESS = path.join(REPO, 'docs/node_modules/vitepress/bin/vitepress.js');
const CONFIG = 'docs/.vitepress/config.mts';
// A build of the whole site takes tens of seconds; the per-test timeout of kit's run-tests is the limit.
const TIMEOUT_MS = 300_000;
const SKIPPED = new Set(['.git', 'node_modules', 'var', 'vendor', 'target', '.vitepress']);

/** The Markdown files below `base`, as posix paths relative to it, skipping the directories that hold no document. */
function markdownFiles(base: string, relative = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(base, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) found.push(...markdownFiles(base, rel));
    } else if (entry.name.endsWith('.md')) found.push(rel);
  }
  return found;
}

// A build warning is a line of the build output (ANSI colour codes removed) that starts with `(!)`, `warn` or `warning`, or
// that names a circular chunk or dependency. A build with any such line fails the test (S-20-1): the warning is a defect of the
// configuration, not output to accept.
const WARNING = /^(?:\(!\)|warn\b|warning\b)|Circular (?:chunk|dependency)/i;
export function warningLines(output: string): string[] {
  return stripVTControlCharacters(output).split('\n').filter(line => WARNING.test(line.trim()));
}

/** Runs the VitePress build of the site whose docs directory is `docs`, without VITEPRESS_BASE. */
function build(docs: string) {
  const env = { ...process.env };
  delete env.VITEPRESS_BASE;
  return spawnSync(process.execPath, [VITEPRESS, 'build', docs], { cwd: path.dirname(docs), encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
}

// An image of a document (`![alt](relative path)`) is part of the page, so the mirror copies it with the document.
const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** The repository paths of the local images that the Markdown file `rel` shows. */
function imagesOf(rel: string): string[] {
  const text = readFileSync(path.join(REPO, rel), 'utf8');
  return [...text.matchAll(IMAGE)].map(match => {
    const target = match[1];
    if (target === undefined) throw new Error(`the image pattern matched ${match[0]} in ${rel} without its target`);
    return target;
  }).filter(target => !/^[a-z]+:/i.test(target))
    .map(target => path.posix.join(path.posix.dirname(rel), target));
}

/** A copy of the repository documents, their images and the site configuration in a temporary directory, with its own docs/. */
function mirror(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-docs-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const documents = markdownFiles(REPO);
  for (const rel of [...documents, ...documents.flatMap(imagesOf), CONFIG, 'docs/package.json']) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  symlinkSync(path.join(REPO, 'docs/node_modules'), path.join(root, 'docs/node_modules'), 'dir');
  return root;
}

test('a link to a document that does not exist fails the build', { timeout: TIMEOUT_MS }, (t) => {
  const root = mirror(t);
  writeFileSync(path.join(root, 'docs/spec/broken-link.md'), '# Broken link\n\n[missing](./no-such-page.md)\n');
  const result = build(path.join(root, 'docs'));
  assert.notEqual(result.status, 0, `the build succeeded with a dead link\n${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, /dead link/i);
  assert.match(`${result.stdout}${result.stderr}`, /broken-link/);
});

test('the site builds from the repository documents, with the English and Korean roots and a package page', { timeout: TIMEOUT_MS }, () => {
  const result = build(path.join(REPO, 'docs'));
  assert.equal(result.status, 0, `the build failed\n${result.stdout}${result.stderr}`);
  assert.deepEqual(warningLines(result.stdout + result.stderr), [], 'the build prints a warning');
  const out = path.join(REPO, 'docs/.vitepress/dist');
  for (const page of ['index.html', 'README.ko.html', 'packages/go/index.html', 'docs/spec/fsm.html', 'docs/plans/fsm-v1.html']) {
    assert.ok(existsSync(path.join(out, page)), `the build produced no ${page}`);
  }
  // A repository file that is not a site page is linked to its public repository, not to a dead route (C-8).
  const home = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /https:\/\/github\.com\/polyspec\/fsm\/blob\/main\/AGENTS\.md/);
  // A document outside the include list of C-8 is not a page.
  assert.equal(existsSync(path.join(out, 'AGENTS.html')), false, 'AGENTS.md is not a site page');
});

// The install of the documentation packages prints no npm warning (docs/plans/execution-checklist.md, S-20-2; C-8). npm 11
// warns about the install scripts that docs/package.json does not decide (its allowScripts field), so a fresh `npm ci` of
// docs/package-lock.json, run in a temporary directory with the same package.json and lock, must print no warning line. An
// install-script warning is decided in docs/package.json, which the test then passes.
const NPM_WARNING = /^npm (?:warn|WARN|error|ERR!)\b/i;

test('the docs install prints no npm warning', { timeout: TIMEOUT_MS }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-docs-install-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(path.join(REPO, 'docs/package.json'), path.join(dir, 'package.json'));
  copyFileSync(path.join(REPO, 'docs/package-lock.json'), path.join(dir, 'package-lock.json'));
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `npm ci failed\n${result.stdout}${result.stderr}`);
  const warnings = `${result.stdout}\n${result.stderr}`.split('\n').map(line => line.trim()).filter(line => NPM_WARNING.test(line));
  assert.deepEqual(warnings, [], 'npm prints a warning on the install of the docs packages');
});
