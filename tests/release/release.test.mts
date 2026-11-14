// The recipes of the release of the core and its bindings (docs/plans/fsm-v1/plan.md, C-11; binding GN-19 to GN-19g): each
// builds the asset of the platform of its host with a standard tool. A case runs the recipe on a copy of the Makefile, with
// stand-ins of rustc, cargo and the llvm-strip of the toolchain that the case writes, so it builds nothing: the stand-ins record
// their arguments and write the files that the real tools write.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanEnv, copyMakeFiles } from '../support/make-sandbox.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The platforms of a release (GN-19a): the Rust triple of the host and the directory of the Go module that holds its library.
const PLATFORMS = [
  { triple: 'x86_64-unknown-linux-gnu', go: 'linux_amd64', pie: 'x86_64-linux-glibc' },
  { triple: 'aarch64-unknown-linux-gnu', go: 'linux_arm64', pie: 'arm64-linux-glibc' },
  { triple: 'aarch64-apple-darwin', go: 'darwin_arm64', pie: 'arm64-darwin-bsdlibc' },
] as const;

/** The PHP of a case: its minor, whether it is a thread-safe or a debug build, and whether the extension fails to load. */
interface Php {
  minor: string;
  zts?: boolean;
  debug?: boolean;
  loadFails?: boolean;
}

// The commit time of HEAD in a sandbox and its seconds since the epoch.
const COMMIT_DATE = '2026-01-02T03:04:05Z';
const COMMIT_EPOCH = String(Date.parse(COMMIT_DATE) / 1000);

/** A copy of the Makefile with the stand-ins of one case. */
interface Sandbox {
  dir: string;
  /** The PHP of the case, by its path: the Makefile puts the tools of the checkout, a PHP among them, before the PATH of a case. */
  php: string;
  sysroot: string;
  env: NodeJS.ProcessEnv;
  /** The commands that the stand-ins received, each as its words, the first the name of the program. */
  calls: () => string[][];
}

/** Writes an executable shell script `file` with the lines `text`, after the PATH of the system. */
function program(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nPATH=/usr/bin:/bin\n${text}`);
  chmodSync(file, 0o755);
}

/**
 * Makes the sandbox of a case whose host is the Rust triple `host`. rustc prints that host and the sysroot of the case; cargo
 * writes the library of the crate into the target directory that CARGO_TARGET_DIR names; the llvm-strip of the sysroot
 * replaces the file that it strips with the word stripped, or fails when `stripFails`; a strip on PATH records its call.
 */
function sandbox(t: TestContext, host: string, stripFails = false, php: Php = { minor: '8.4' }): Sandbox {
  const tmp = mkdtempSync(path.join(tmpdir(), 'fsm-release-'));
  t.after(() => { rmSync(tmp, { recursive: true, force: true }); });
  const dir = copyMakeFiles(ROOT, tmp);
  const bin = path.join(tmp, 'bin');
  const sysroot = path.join(tmp, 'sysroot');
  const calls = path.join(tmp, 'calls');
  const record = `line=$(basename "$0"); for word in "$@"; do line="$line\t$word"; done; printf '%s\\n' "$line" >> '${calls}'\n`;
  program(path.join(bin, 'rustc'), `${record}case "$*" in
'--print host-tuple') echo '${host}' ;;
'--print sysroot') echo '${sysroot}' ;;
*) exit 9 ;;
esac
`);
  // cargo pkgid prints the package id of the PHP extension at the version of a release; cargo build writes the library of
  // the crate that -p names, the cdylib of the extension under the name of either platform.
  program(path.join(bin, 'cargo'), `${record}case "$1" in
pkgid) echo 'path+file:///checkout/packages/php-ext#polyspec-fsm-php-ext@1.2.3'; exit 0 ;;
esac
printf 'cargo\\tCARGO_TARGET_DIR=%s\\tPHP=%s\\tPHP_CONFIG=%s\\n' "$CARGO_TARGET_DIR" "$PHP" "$PHP_CONFIG" >> '${calls}'
mkdir -p "$CARGO_TARGET_DIR/release"
case "$*" in
*polyspec-fsm-go*) printf 'library with debug sections\\n' > "$CARGO_TARGET_DIR/release/libpolyspec_fsm_go.a" ;;
*polyspec-fsm-php-ext*) for ext in so dylib; do printf 'extension\\n' > "$CARGO_TARGET_DIR/release/libpolyspec_fsm.$ext"; done ;;
esac
`);
  // The PHP of the case answers the code of -r: its minor, its build, and the load check, which reads the extension of -d.
  program(path.join(bin, 'php'), `${record}for code in "$@"; do :; done
case "$code" in
*PHP_MINOR_VERSION*) printf '%s' '${php.minor}' ;;
*PHP_ZTS*) printf '%s' '${php.debug ? '-debug' : ''}-${php.zts ? 'zts' : 'nts'}' ;;
*extension_loaded*) ${php.loadFails ? 'exit 1' : 'case "$3" in extension=/*) test "$(cat "${3#extension=}")" = extension ;; *) exit 1 ;; esac'} ;;
*) exit 9 ;;
esac
`);
  // zip records its directory and writes the archive that it names.
  program(path.join(bin, 'zip'), `${record}printf 'zip\\tPWD=%s\\n' "$PWD" >> '${calls}'
printf 'zip of %s\\n' "$5" > "$4"
`);
  program(path.join(bin, 'strip'), record);
  program(path.join(sysroot, 'lib/rustlib', host, 'bin/llvm-strip'), `${record}${stripFails ? 'exit 1\n' : `for last in "$@"; do :; done; printf 'stripped\\n' > "$last"\n`}`);
  // The uv of the checkout, which the Makefile starts by its path in var/tools: it records the environment of maturin and
  // writes a wheel into the directory of --out-dir.
  program(path.join(dir, 'var/tools/mise/shims/uv'), `${record}printf 'uv\\tCARGO_TARGET_DIR=%s\\tMATURIN_PEP517_ARGS=%s\\tSOURCE_DATE_EPOCH=%s\\n' "$CARGO_TARGET_DIR" "$MATURIN_PEP517_ARGS" "$SOURCE_DATE_EPOCH" >> '${calls}'
while [ "$1" != --out-dir ]; do shift; done
mkdir -p "$2" && printf 'wheel\\n' > "$2/polyspec_fsm-0.0.13-cp314-abi3-platform.whl"
`);
  // The commit of HEAD, whose time is the SOURCE_DATE_EPOCH of a wheel.
  const git = (...args: string[]): void => {
    spawnSync('git', ['-C', dir, ...args], { env: { ...cleanEnv(), GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  };
  git('commit', '-q', '--allow-empty', '-m', 'release');
  return {
    dir,
    php: path.join(bin, 'php'),
    sysroot,
    env: { ...cleanEnv(), PATH: `${bin}:/usr/bin:/bin` },
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\t')) : []),
  };
}

/** Runs make with `args` in the sandbox. */
function make(box: Sandbox, args: string[]): ReturnType<typeof spawnSync<string>> {
  return spawnSync('make', ['--no-print-directory', ...args], { cwd: box.dir, encoding: 'utf8', env: box.env });
}

// ---- release-go-static (GN-19b, S-470-4) --------------------------------------------------------------------------------

test('release-go-static builds the Go library of the platform of the host and strips a copy with the llvm-strip of the toolchain', async t => {
  for (const { triple, go } of PLATFORMS) {
    await t.test(triple, t2 => {
      const box = sandbox(t2, triple);
      const ran = make(box, ['release-go-static']);
      assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
      const asset = path.join(box.dir, 'var/release/assets/go', go, 'libpolyspec_fsm_go.a');
      assert.equal(readFileSync(asset, 'utf8'), 'stripped\n');
      // The library that cargo built stays as it was: the strip runs on a copy.
      assert.equal(readFileSync(path.join(box.dir, 'var/release/target/release/libpolyspec_fsm_go.a'), 'utf8'), 'library with debug sections\n');
      const calls = box.calls();
      assert.deepEqual(calls.filter(call => call[0] === 'cargo'), [
        ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-fsm-go'],
        ['cargo', 'CARGO_TARGET_DIR=var/release/target', 'PHP=', 'PHP_CONFIG='],
      ]);
      const stripped = calls.filter(call => call[0] === 'llvm-strip');
      assert.equal(stripped.length, 1, JSON.stringify(calls));
      assert.equal(stripped[0]?.[1], '--strip-debug');
      // No strip of PATH, which differs by machine.
      assert.deepEqual(calls.filter(call => call[0] === 'strip'), []);
      // Only the asset is left in its directory: the copy was renamed.
      assert.deepEqual(spawnSync('ls', ['-A', path.dirname(asset)], { encoding: 'utf8' }).stdout, 'libpolyspec_fsm_go.a\n');
    });
  }
});

test('release-go-static writes into RELEASE_ASSETS and builds into RELEASE_TARGET', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = make(box, ['release-go-static', 'RELEASE_ASSETS=out/assets', 'RELEASE_TARGET=out/target']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(readFileSync(path.join(box.dir, 'out/assets/go/darwin_arm64/libpolyspec_fsm_go.a'), 'utf8'), 'stripped\n');
  assert.ok(box.calls().some(call => call[0] === 'cargo' && call[1] === 'CARGO_TARGET_DIR=out/target'), JSON.stringify(box.calls()));
});

test('release-go-static fails with 2 on a host that is no platform of the release, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-pc-windows-msvc');
  const ran = make(box, ['release-go-static']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-static: the host x86_64-pc-windows-msvc is no platform of the release: x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, aarch64-apple-darwin/);
  assert.deepEqual(box.calls().filter(call => call[0] !== 'rustc'), []);
});

test('a strip that fails leaves no library in the assets', t => {
  const box = sandbox(t, 'aarch64-unknown-linux-gnu', true);
  const ran = make(box, ['release-go-static']);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(existsSync(path.join(box.dir, 'var/release/assets/go/linux_arm64/libpolyspec_fsm_go.a')), false);
});

// ---- release-wheel (GN-19c, S-470-5) ---------------------------------------------------------------------------------------

// The generation of the Python binding is a prerequisite of the wheel; a case marks it as done, so make runs the recipe alone.
const GENERATED = ['-o', 'bindings-python'];

test('release-wheel builds the abi3 wheel of the host with uv, maturin locked and the commit time of HEAD', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, [...GENERATED, 'release-wheel']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const calls = box.calls().filter(call => call[0] === 'uv');
  assert.deepEqual(calls, [
    ['uv', 'build', '--wheel', '--python', 'python3', '--out-dir', 'var/release/assets/wheel', 'packages/python'],
    ['uv', 'CARGO_TARGET_DIR=var/release/target', 'MATURIN_PEP517_ARGS=--locked', `SOURCE_DATE_EPOCH=${COMMIT_EPOCH}`],
  ]);
  assert.equal(readFileSync(path.join(box.dir, 'var/release/assets/wheel/polyspec_fsm-0.0.13-cp314-abi3-platform.whl'), 'utf8'), 'wheel\n');
});

test('release-wheel generates the Python binding first', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  // The install of the generator is keyed on the root Cargo.lock, which the copy of the Makefile holds empty.
  writeFileSync(path.join(box.dir, 'Cargo.lock'), '');
  const ran = make(box, ['-n', 'release-wheel']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const lines = ran.stdout.split('\n');
  const generate = lines.findIndex(line => / generate --root \S+ --target python$/.test(line));
  const build = lines.findIndex(line => line.includes(' build --wheel '));
  assert.ok(generate >= 0 && build > generate, ran.stdout);
});

test('release-wheel fails with 2 on a host that is no platform of the release, and builds nothing', t => {
  const box = sandbox(t, 'riscv64gc-unknown-linux-gnu');
  const ran = make(box, [...GENERATED, 'release-wheel']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-wheel: the host riscv64gc-unknown-linux-gnu is no platform of the release/);
  assert.deepEqual(box.calls().filter(call => call[0] === 'uv'), []);
});

// ---- release-php-ext (GN-19d, S-470-6) -------------------------------------------------------------------------------------

test('release-php-ext builds, loads and packs the PHP extension under the name by which PIE finds it', async t => {
  for (const { triple, pie } of PLATFORMS) {
    for (const php of [{ minor: '8.4' }, { minor: '8.5', zts: true }, { minor: '8.3', debug: true, zts: true }] as Php[]) {
      const build = `${php.debug ? '-debug' : ''}-${php.zts ? 'zts' : 'nts'}`;
      await t.test(`${triple} php${php.minor}${build}`, t2 => {
        const box = sandbox(t2, triple, false, php);
        const ran = make(box, ['release-php-ext', `PHP=${box.php}`]);
        assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
        const name = `php_polyspec_fsm-v1.2.3_php${php.minor}-${pie}${build}.zip`;
        const assets = path.join(box.dir, 'var/release/assets/php-ext');
        assert.equal(readFileSync(path.join(assets, name), 'utf8'), 'zip of polyspec_fsm.so\n');
        // Only the archive is left in the assets: the copy was renamed.
        assert.equal(spawnSync('ls', ['-A', assets], { encoding: 'utf8' }).stdout, `${name}\n`);
        const calls = box.calls();
        assert.deepEqual(calls.filter(call => call[0] === 'cargo' && call[1] !== 'pkgid'), [
          ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-fsm-php-ext'],
          ['cargo', 'CARGO_TARGET_DIR=var/release/target', `PHP=${box.php}`, `PHP_CONFIG=${box.php}-config`],
        ]);
        // The load check runs on the copy that is packed, by its absolute path, without a php.ini.
        // make names it under the real path of its directory.
        const copy = path.join(realpathSync(box.dir), 'var/release/target/php-ext', `php${php.minor}${build}`);
        const load = calls.find(call => call[0] === 'php' && call.some(word => word.includes('extension_loaded')));
        assert.deepEqual(load, ['php', '-n', '-d', `extension=${copy}/polyspec_fsm.so`, '-r', 'exit(extension_loaded("polyspec_fsm") ? 0 : 1);']);
        assert.deepEqual(calls.filter(call => call[0] === 'zip'), [['zip', '-q', '-9', '-X', name, 'polyspec_fsm.so'], ['zip', `PWD=${copy}`]]);
      });
    }
  }
});

test('release-php-ext passes PHP_CONFIG and writes into RELEASE_ASSETS', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = make(box, ['release-php-ext', `PHP=${box.php}`, 'PHP_CONFIG=/opt/php/bin/php-config', 'RELEASE_ASSETS=out/assets']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(existsSync(path.join(box.dir, 'out/assets/php-ext/php_polyspec_fsm-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip')));
  assert.ok(box.calls().some(call => call[0] === 'cargo' && call[3] === 'PHP_CONFIG=/opt/php/bin/php-config'), JSON.stringify(box.calls()));
});

test('release-php-ext packs nothing when the extension does not load', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu', false, { minor: '8.4', loadFails: true });
  const ran = make(box, ['release-php-ext', `PHP=${box.php}`]);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter(call => call[0] === 'zip'), []);
  assert.equal(existsSync(path.join(box.dir, 'var/release/assets/php-ext')), false);
});

test('release-php-ext fails with 2 without PHP, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['release-php-ext']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: PHP is required, for example make release-php-ext PHP=php/);
  assert.deepEqual(box.calls(), []);
});

test('release-php-ext fails with 2 on a host that is no platform of the release, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-apple-darwin');
  const ran = make(box, ['release-php-ext', `PHP=${box.php}`]);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: the host x86_64-apple-darwin is no platform of the release/);
  assert.deepEqual(box.calls().filter(call => call[0] !== 'rustc'), []);
});
