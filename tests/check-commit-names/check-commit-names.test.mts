// The checker of commit names: which words of a line it reports, and that it reads the tracked documents alone.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { commitNames, findings } from '../../scripts/check-commit-names.mts';

test('a word of 7 to 40 hexadecimal digits with a digit and a letter is a commit name', () => {
  assert.deepEqual(commitNames('`Cargo.lock` pins binding at 9de9d03, the commit'), ['9de9d03']);
  assert.deepEqual(commitNames('on the tree 6f852f4 with binding a03ba03.'), ['6f852f4', 'a03ba03']);
  assert.deepEqual(commitNames('the commit 3b4bc6bfc45bd1069734d290958a30c6bf2a9f66 of binding'), ['3b4bc6bfc45bd1069734d290958a30c6bf2a9f66']);
  assert.deepEqual(commitNames('(96da077, 5d17159)'), ['96da077', '5d17159']);
});

test('a digest, a number, a word and a part of a longer name are no commit names', () => {
  assert.deepEqual(commitNames('<!-- source-sha256: 887b911ac79315ba0e512d00c23cfef5198b51ea0f775df7260fb1c97cc850da -->'), []);
  assert.deepEqual(commitNames('1234567 tests and 0000000 failures'), []);
  assert.deepEqual(commitNames('the feedback of a decade'), []);
  assert.deepEqual(commitNames('`a:2:{i:0;i:1;i:1;R:2;}` and S-457-1 and v0.0.13 and K1053'), []);
  assert.deepEqual(commitNames('packages/abc1234/file and abc1234.md and abc1234_x and x-abc1234'), []);
});

test('the findings are those of the tracked documents, each with its file and line', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fsm-commit-names-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const git = (...args: string[]): void => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/a.md'), 'first line\nbinding 49a4e97 is pinned\n');
  writeFileSync(join(root, 'b.md'), 'no name here\n');
  writeFileSync(join(root, 'untracked.md'), 'binding 49a4e97\n');
  writeFileSync(join(root, 'data.json'), '"49a4e97"\n');
  git('add', 'docs/a.md', 'b.md', 'data.json');
  assert.deepEqual(findings(root), [{ file: 'docs/a.md', line: 2, name: '49a4e97' }]);
});
