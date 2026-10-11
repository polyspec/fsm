// Tests of `make install-python` (docs/plans/execution-checklist.md, S-11-3 and S-35; the Makefile comment of install-python).
// uv installs the Python of config/toolchain.json with --no-bin, so it writes no interpreter link into a user bin directory;
// the only file the target writes in the checkout is the link var/tools/bin/python3. The test runs the target in a temporary
// checkout with a stub uv first on PATH, so it needs no network and touches no real bin directory: the stub logs its
// arguments and, without --no-bin, writes python3.14 into UV_PYTHON_BIN_DIR (or ~/.local/bin), as uv does.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RECIPE = '$(UV) python install --no-bin 3.14';
const CONTROL = '$(UV) python install 3.14';

const STUB_UV = `#!/bin/sh
# A stand-in for uv: it logs its arguments. Without --no-bin it writes the interpreter link into the bin directory.
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1 $2" in
  "python install")
    case " $* " in
      *" --no-bin "*) ;;
      *) mkdir -p "\${UV_PYTHON_BIN_DIR:-$HOME/.local/bin}" && : > "\${UV_PYTHON_BIN_DIR:-$HOME/.local/bin}/python3.14" ;;
    esac ;;
  "python find") printf '%s\\n' "$STUB_PYTHON" ;;
  *) echo "stub uv: unexpected arguments: $*" >&2; exit 2 ;;
esac
`;

/** The regular files and the symbolic links below `root`, as paths relative to it, sorted (directories are not listed). */
function entries(root) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const target = path.join(dir, name);
      const info = lstatSync(target);
      if (info.isDirectory()) walk(target);
      else found.push(path.relative(root, target));
    }
  };
  walk(root);
  return found;
}

/**
 * Runs `make install-python` in a temporary checkout whose install-python recipe is `recipe`. Returns the make result, the
 * log of the stub, the scratch bin directory, the scratch home and the entries that the run created in the checkout.
 */
function install(t, recipe = RECIPE) {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-python-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = path.join(dir, 'checkout');
  const stub = path.join(dir, 'stub');
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'uv-bin');
  mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  mkdirSync(path.join(checkout, 'contracts'));
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(stub);
  mkdirSync(bin);
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(checkout, 'scripts/kit'), { recursive: true });
  cpSync(path.join(ROOT, 'contracts/layout.json'), path.join(checkout, 'contracts/layout.json'));
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  if (makefile.split(RECIPE).length !== 2) throw new Error('the install-python recipe of the Makefile is not the one this test expects');
  writeFileSync(path.join(checkout, 'Makefile'), makefile.replace(RECIPE, () => recipe));
  writeFileSync(path.join(stub, 'uv'), STUB_UV, { mode: 0o755 });
  writeFileSync(path.join(stub, 'python3.14'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const log = path.join(dir, 'uv.log');
  const before = entries(checkout);
  const result = spawnSync('make', ['-C', checkout, 'install-python'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub}${path.delimiter}${process.env.PATH}`,
      HOME: home,
      UV_PYTHON_BIN_DIR: bin,
      STUB_LOG: log,
      STUB_PYTHON: path.join(stub, 'python3.14'),
    },
  });
  const created = entries(checkout).filter(entry => !before.includes(entry));
  return { result, checkout, home, bin, log, created, stub };
}

test('install-python installs with --no-bin, so no interpreter link lands in a bin directory', (t) => {
  const run = install(t);
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.equal(readFileSync(run.log, 'utf8'), 'python install --no-bin 3.14\npython find --managed-python 3.14\n');
  assert.deepEqual(readdirSync(run.bin), [], 'the bin directory of uv stays empty');
  assert.deepEqual(readdirSync(path.join(run.home, '.local', 'bin')), [], '~/.local/bin is unchanged');
});

test('install-python writes in the checkout only the link var/tools/bin/python3 to the managed interpreter', (t) => {
  const run = install(t);
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.deepEqual(run.created, ['var/tools/bin/python3']);
  const link = path.join(run.checkout, 'var/tools/bin/python3');
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(readlinkSync(link), path.join(run.stub, 'python3.14'));
});

test('control: a recipe without --no-bin writes python3.14 into the bin directory, which the first test would refuse', (t) => {
  const run = install(t, CONTROL);
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.deepEqual(readdirSync(run.bin), ['python3.14']);
});
