// Tests of scripts/check-readmes.mjs (docs/plans/execution-checklist.md, S-19): every README pair declared by the checker has its
// English file, its Korean twin, every required English section, and a Korean twin with the same number of headings per level.
// A README without a required section fails. Every case builds its checkout in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { README_PAIRS, readmeFindings } from '../../scripts/check-readmes.mjs';
import { tree } from '../kit/tree.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/check-readmes.mjs');

/** The English text of a README with the required sections of its kind, each followed by a paragraph. */
function english(pair, sections = pair.sections) {
  return `# ${pair.en}\n\n${sections.map(section => `## ${section}\n\nText of ${section}.\n`).join('\n')}`;
}

/** A Korean twin with the same heading structure as the English text: the heading texts are replaced. */
function korean(text) {
  let index = 0;
  return text.replace(/^(#{1,6}) .+$/gm, (_, hashes) => `${hashes} 제목 ${index++}`);
}

/** Every declared pair, complete. Returns the files by path. */
function complete() {
  const files = {};
  for (const pair of README_PAIRS) {
    const text = english(pair);
    files[pair.en] = text;
    files[pair.ko] = korean(text);
  }
  return files;
}

test('a checkout with every declared README complete has no finding', (t) => {
  const root = tree(t, complete());
  assert.deepEqual(readmeFindings(root), []);
});

test('a README without a required section is a finding that names the section', (t) => {
  const files = complete();
  const pair = README_PAIRS.find(p => p.en === 'packages/fsm-gui/README.md');
  files[pair.en] = english(pair, pair.sections.filter(section => section !== 'Rules'));
  files[pair.ko] = korean(files[pair.en]);
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/fsm-gui/README.md', message: 'missing section ## Rules' },
  ]);
});

test('a Korean twin with a different number of headings is a finding', (t) => {
  const files = complete();
  files['README.ko.md'] = `${files['README.ko.md']}\n### 추가\n`;
  const root = tree(t, files);
  const findings = readmeFindings(root);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].file, 'README.ko.md');
  assert.match(findings[0].message, /has 1 heading\(s\) of level 3, the English README has 0/);
});

test('a missing Korean twin is a finding', (t) => {
  const files = complete();
  delete files['packages/fsm-go/README.ko.md'];
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/fsm-go/README.ko.md', message: 'the Korean twin is missing' },
  ]);
});

test('a missing English README is a finding', (t) => {
  const files = complete();
  delete files['packages/fsm-rust/README.md'];
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/fsm-rust/README.md', message: 'the README is missing' },
  ]);
});

test('a heading inside a fenced code block is not a section', (t) => {
  const files = complete();
  const pair = README_PAIRS.find(p => p.en === 'packages/fsm-npm/README.md');
  const sections = pair.sections.filter(section => section !== 'Errors');
  files[pair.en] = `${english(pair, sections)}\n\`\`\`sh\n## Errors\n\`\`\`\n`;
  files[pair.ko] = korean(files[pair.en]);
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/fsm-npm/README.md', message: 'missing section ## Errors' },
  ]);
});

test('the command prints each finding and exits 1, and exits 0 when there is none', (t) => {
  const files = complete();
  delete files['packages/fsm-go/README.ko.md'];
  const failing = spawnSync(process.execPath, [SCRIPT, '--root', tree(t, files)], { encoding: 'utf8' });
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(failing.stderr, /^\[check-readmes\] packages\/fsm-go\/README\.ko\.md: the Korean twin is missing$/m);

  const passing = spawnSync(process.execPath, [SCRIPT, '--root', tree(t, complete())], { encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(passing.stdout, /^\[check-readmes\] every README has its sections and its Korean twin$/m);
});
