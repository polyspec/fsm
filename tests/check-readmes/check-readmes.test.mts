// Tests of scripts/check-readmes.mts (docs/plans/execution-checklist.md, S-19): every README pair declared by the checker has its
// English file, its Korean twin, every required English section, and a Korean twin with the same number of headings per level.
// A README without a required section fails. Every case builds its checkout in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { README_PAIRS, type ReadmeFinding, type ReadmePair, readmeFindings } from '../../scripts/check-readmes.mts';
import { tree } from '../support/tree.mts';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/check-readmes.mts');

/** The English text of a README with the required sections of its kind, each followed by a paragraph. */
function english(pair: ReadmePair, sections: readonly string[] = pair.sections): string {
  return `# ${pair.en}\n\n${sections.map(section => `## ${section}\n\nText of ${section}.\n`).join('\n')}`;
}

/** A Korean twin with the same heading structure as the English text: the heading texts are replaced. */
function korean(text: string): string {
  let index = 0;
  return text.replace(/^(#{1,6}) .+$/gm, (_heading: string, hashes: string) => `${hashes} 제목 ${index++}`);
}

/** The README pair whose English file is `en`. */
function pairOf(en: string): ReadmePair {
  const pair = README_PAIRS.find(p => p.en === en);
  if (pair === undefined) throw new Error(`no README pair declares ${en}`);
  return pair;
}

/** The text of `file` in `files`. */
function textOf(files: Record<string, string>, file: string): string {
  const text = files[file];
  if (text === undefined) throw new Error(`the files hold no ${file}`);
  return text;
}

/** The only finding of `findings`. */
function only(findings: ReadmeFinding[]): ReadmeFinding {
  const [finding] = findings;
  assert.equal(findings.length, 1, JSON.stringify(findings));
  if (finding === undefined) throw new Error('there is no finding');
  return finding;
}

/** Every declared pair, complete. Returns the files by path. */
function complete(): Record<string, string> {
  const files: Record<string, string> = {};
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
  const pair = pairOf('packages/gui/README.md');
  files[pair.en] = english(pair, pair.sections.filter(section => section !== 'Rules'));
  files[pair.ko] = korean(textOf(files, pair.en));
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/gui/README.md', message: 'missing section ## Rules' },
  ]);
});

test('a Korean twin with a different number of headings is a finding', (t) => {
  const files = complete();
  files['README.ko.md'] = `${textOf(files, 'README.ko.md')}\n### 추가\n`;
  const root = tree(t, files);
  const finding = only(readmeFindings(root));
  assert.equal(finding.file, 'README.ko.md');
  assert.match(finding.message, /has 1 heading\(s\) of level 3, the English README has 0/);
});

test('a missing Korean twin is a finding', (t) => {
  const files = complete();
  delete files['packages/go/README.ko.md'];
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/go/README.ko.md', message: 'the Korean twin is missing' },
  ]);
});

test('a missing English README is a finding', (t) => {
  const files = complete();
  delete files['packages/rust/README.md'];
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/rust/README.md', message: 'the README is missing' },
  ]);
});

test('a heading inside a fenced code block is not a section', (t) => {
  const files = complete();
  const pair = pairOf('packages/js/README.md');
  const sections = pair.sections.filter(section => section !== 'Errors');
  files[pair.en] = `${english(pair, sections)}\n\`\`\`sh\n## Errors\n\`\`\`\n`;
  files[pair.ko] = korean(textOf(files, pair.en));
  const root = tree(t, files);
  assert.deepEqual(readmeFindings(root), [
    { file: 'packages/js/README.md', message: 'missing section ## Errors' },
  ]);
});

test('the command prints each finding and exits 1, and exits 0 when there is none', (t) => {
  const files = complete();
  delete files['packages/go/README.ko.md'];
  const failing = spawnSync(process.execPath, [SCRIPT, '--root', tree(t, files)], { encoding: 'utf8' });
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(failing.stderr, /^\[check-readmes\] packages\/go\/README\.ko\.md: the Korean twin is missing$/m);

  const passing = spawnSync(process.execPath, [SCRIPT, '--root', tree(t, complete())], { encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(passing.stdout, /^\[check-readmes\] every README has its sections and its Korean twin$/m);
});
