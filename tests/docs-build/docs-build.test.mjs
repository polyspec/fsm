// Tests of the documentation site (docs/.vitepress/config.mts, `make docs-build`; docs/plans/fsm-v1.md, C-8). The site is built
// from the repository documents in place. A broken link must fail the build, and the real build must produce the pages of the
// English and Korean root, a package and the link rewrite. Each broken case builds a copy of the repository documents and the
// site configuration in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITEPRESS = path.join(REPO, 'docs/node_modules/vitepress/bin/vitepress.js');
const CONFIG = 'docs/.vitepress/config.mts';
// A build of the whole site takes tens of seconds; the runner's per-test timeout (scripts/kit/run-tests.mjs) is the limit.
const TIMEOUT_MS = 300_000;
const SKIPPED = new Set(['.git', 'node_modules', 'var', 'vendor', 'target', '.vitepress']);

/** The Markdown files below `base`, as posix paths relative to it, skipping the directories that hold no document. */
function markdownFiles(base, relative = '') {
  const found = [];
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
const ANSI = /\u001b\[[0-9;]*m/g;
const WARNING = /^(?:\(!\)|warn\b|warning\b)|Circular (?:chunk|dependency)/i;
export function warningLines(output) {
  return output.replace(ANSI, '').split('\n').filter(line => WARNING.test(line.trim()));
}

/** Runs the VitePress build of the site whose docs directory is `docs`, without VITEPRESS_BASE. */
function build(docs) {
  const env = { ...process.env };
  delete env.VITEPRESS_BASE;
  return spawnSync(process.execPath, [VITEPRESS, 'build', docs], { cwd: path.dirname(docs), encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
}

/** A copy of the repository documents and of the site configuration in a temporary directory, with its own docs/. */
function mirror(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-docs-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const rel of [...markdownFiles(REPO), CONFIG, 'docs/package.json']) {
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
  for (const page of ['index.html', 'README.ko.html', 'packages/fsm-go/index.html', 'docs/spec/fsm.html', 'docs/plans/fsm-v1.html']) {
    assert.ok(existsSync(path.join(out, page)), `the build produced no ${page}`);
  }
  // A repository file that is not a site page is linked to its public repository, not to a dead route (C-8).
  const home = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /https:\/\/github\.com\/polyspec\/fsm\/blob\/main\/AGENTS\.md/);
  // A document outside the include list of C-8 is not a page.
  assert.equal(existsSync(path.join(out, 'AGENTS.html')), false, 'AGENTS.md is not a site page');
});
