// Tests of scripts/binding.mts (docs/plans/fsm-v1/checklist.md, S-477): the generator of the binding packages is the one of
// the commit that the root Cargo.lock pins, read from the output of cargo metadata; a command other than install runs only
// an installed generator. The fixtures are built in temporary directories, and no test runs cargo, git or npm.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isInstalled, pinned, toolFolder } from '../../scripts/binding.mts';
import { put, tree } from '../support/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CHECKOUT = '/cargo/git/checkouts/binding-0000000000000000/0123456';

/** The package of polyspec-binding-core as cargo metadata gives it, with the source `source`. */
function core(source: string | null): Record<string, unknown> {
  return { name: 'polyspec-binding-core', source, manifest_path: `${CHECKOUT}/packages/core/rust/Cargo.toml` };
}

test('the pinned generator is the commit of polyspec-binding-core and the checkout that holds its crate', () => {
  const metadata = { packages: [{ name: 'polyspec-fsm', source: null, manifest_path: '/fsm/packages/rust/Cargo.toml' }, core(`git+https://example.test/binding.git?branch=line#${COMMIT}`)] };
  assert.deepEqual(pinned(metadata), { commit: COMMIT, checkout: CHECKOUT });
});

test('a lock without the Git dependency, or with a source that pins no commit, is an error that names the crate', () => {
  assert.throws(() => pinned({ packages: [] }), /Cargo\.lock has no Git dependency polyspec-binding-core/);
  assert.throws(() => pinned({ packages: [core(null)] }), /Cargo\.lock has no Git dependency polyspec-binding-core/);
  assert.throws(() => pinned({ packages: [core('registry+https://example.test/index')] }), /polyspec-binding-core has no pinned commit: registry\+/);
  assert.throws(() => pinned({ packages: [core('git+https://example.test/binding.git?branch=line#0123')] }), /has no pinned commit/);
  assert.throws(() => pinned({}), /cargo metadata gave no list of packages/);
});

test('a generator is installed when its folder of the commit holds the packages that npm installed', (t) => {
  const root = tree(t);
  assert.equal(toolFolder(root, COMMIT), path.join(root, 'var/binding', COMMIT));
  assert.equal(isInstalled(root, COMMIT), false);
  // A clone whose install of the packages did not end is not installed.
  put(root, { [`var/binding/${COMMIT}/packages/ts/package-lock.json`]: '{}\n' });
  assert.equal(isInstalled(root, COMMIT), false);
  put(root, { [`var/binding/${COMMIT}/packages/ts/node_modules/.package-lock.json`]: '{}\n' });
  assert.equal(isInstalled(root, COMMIT), true);
  assert.equal(isInstalled(root, COMMIT.replace('0', 'f')), false);
});

test('the command without arguments, and install without the npm, end with the exit code 2 and the usage', () => {
  for (const args of [[], ['install'], ['install', 'npm', 'more']]) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/binding.mts'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^usage: node scripts\/binding\.mts install <npm>$/m);
  }
});
