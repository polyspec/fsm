// Tests of the imports of packages/compiler/src (docs/plans/fsm-v1/plan.md, C-5; docs/plans/fsm-v1/checklist.md, S-32). The
// compiler imports only node built-ins (by their `node:` specifier) and its own files (S-44-1: no file of kit, whose
// internals the package @polyspec/kit does not export). Every import specifier of src is scanned: an npm package, a bare
// built-in name, a relative path that leaves src, a dynamic import() or require(), and any node: import in src/core is a
// finding. The fixtures of the last tests are built in temporary directories.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(REPO, 'packages/compiler/src');

// A static import or export that names its module: `import … from 'x'`, `export … from 'x'`, `import 'x'`, at the start of a line.
// The words before `from` hold no quote, so a `from` inside a string of a declaration is not a module.
const STATIC = /^(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"\n]+)['"]|^import\s*['"]([^'"\n]+)['"]/gm;
// A load that a static scan cannot see.
// A quote before the word marks it as text of a string (generated code of a backend), which is not a load.
const DYNAMIC = /(?<!['"`])\b(?:import\s*\(|require\s*\(|createRequire\b)/g;

/** Whether `child` is `parent` or lies below it. */
function within(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/** A temporary directory holding `files` ({ path: text }), removed with `t.after`. */
function tree(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-imports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

/**
 * The findings of one source file: `{ file, specifier, reason }` for each import specifier that the stated set does not allow
 * (`root` is the checkout, `file` a path below it). `src` is the directory the set names.
 */
export function importFindings(root, file, text, src = path.join(root, 'packages/compiler/src')) {
  const findings = [];
  const absolute = path.join(root, file);
  const inCore = within(path.join(src, 'core'), absolute);
  for (const match of text.matchAll(STATIC)) {
    const specifier = match[1] ?? match[2];
    if (specifier.startsWith('node:')) {
      if (inCore) findings.push({ file, specifier, reason: 'src/core imports no node: module' });
      continue;
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = path.resolve(path.dirname(absolute), specifier);
      if (within(src, target)) continue;
      findings.push({ file, specifier, reason: 'a relative import must stay in src' });
      continue;
    }
    findings.push({ file, specifier, reason: 'an npm package or a bare built-in name is not in the stated set' });
  }
  for (const match of text.matchAll(DYNAMIC)) {
    findings.push({ file, specifier: match[0].trim(), reason: 'a dynamic import or require is not in the stated set' });
  }
  return findings;
}

/** The source files below `dir`, as paths relative to `root`, sorted. */
function sourceFiles(root, dir) {
  const files = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const target = path.join(current, name);
      if (statSync(target).isDirectory()) walk(target);
      else if (name.endsWith('.mjs')) files.push(path.relative(root, target));
    }
  };
  walk(dir);
  return files;
}

/** The findings of every source file of the compiler under `root`. */
function findingsIn(root, src) {
  return sourceFiles(root, src).flatMap(file => importFindings(root, file, readFileSync(path.join(root, file), 'utf8'), src));
}

test('every import of the compiler source is in the stated set', () => {
  assert.deepEqual(findingsIn(REPO, SRC), []);
});

test('the source has files in src/core, and none of them imports a node: module', () => {
  const core = sourceFiles(REPO, path.join(SRC, 'core'));
  assert.ok(core.length > 0);
  for (const file of core) {
    const text = readFileSync(path.join(REPO, file), 'utf8');
    assert.doesNotMatch(text, /from\s*['"]node:|import\s*['"]node:/, file);
  }
});

test('an npm package, a bare built-in and a relative path out of the set are findings', (t) => {
  const root = tree(t, {
    'packages/compiler/src/core/bad.mjs': "import { x } from 'lodash';\nimport fs from 'fs';\nimport { node } from 'node:fs';\n",
    'packages/compiler/src/cli/bad.mjs': "import { y } from '../../../db/src/store.mjs';\nexport { z } from 'yaml';\n",
    'packages/compiler/src/cli/good.mjs': "import { w } from '../core/run.mjs';\nimport path from 'node:path';\n",
    'packages/compiler/src/cli/kit.mjs': "import { git } from '../../../../scripts/kit/git.mjs';\n",
  });
  const found = findingsIn(root, path.join(root, 'packages/compiler/src'))
    .map(f => `${f.file} ${f.specifier}`);
  assert.deepEqual(found, [
    'packages/compiler/src/cli/bad.mjs ../../../db/src/store.mjs',
    'packages/compiler/src/cli/bad.mjs yaml',
    'packages/compiler/src/cli/kit.mjs ../../../../scripts/kit/git.mjs',
    'packages/compiler/src/core/bad.mjs lodash',
    'packages/compiler/src/core/bad.mjs fs',
    'packages/compiler/src/core/bad.mjs node:fs',
  ]);
});

test('a dynamic import or require is a finding, wherever it stands', (t) => {
  const root = tree(t, {
    'packages/compiler/src/cli/dyn.mjs': "const m = await import('./x.mjs');\nconst r = require('node:fs');\n",
  });
  const found = findingsIn(root, path.join(root, 'packages/compiler/src'));
  assert.deepEqual(found.map(f => f.specifier), ['import(', 'require(']);
});

test('a string that holds generated code is not an import', (t) => {
  const root = tree(t, {
    'packages/compiler/src/backends/gen.mjs': "const text = [\n    \"import { Code, Error } from './fsm.js';\",\n];\n",
  });
  assert.deepEqual(findingsIn(root, path.join(root, 'packages/compiler/src')), []);
});
