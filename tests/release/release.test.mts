// The recipes of the release of the core and its bindings (docs/plans/fsm-v1/plan.md, C-11; binding GN-19 to GN-19g): each
// builds the asset of the platform of its host with a standard tool. A case runs the recipe on a copy of the Makefile, with
// stand-ins of rustc, cargo and the llvm-strip of the toolchain that the case writes, so it builds nothing: the stand-ins record
// their arguments and write the files that the real tools write.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanEnv, copyMakeFiles } from '../support/make-sandbox.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The platforms of a release (GN-19a): the Rust triple of the host and the directory of the Go module that holds its library.
const PLATFORMS = [
  { triple: 'x86_64-unknown-linux-gnu', platform: 'linux-x64-gnu', go: 'linux_amd64', pie: 'x86_64-linux-glibc' },
  { triple: 'aarch64-unknown-linux-gnu', platform: 'linux-arm64-gnu', go: 'linux_arm64', pie: 'arm64-linux-glibc' },
  { triple: 'aarch64-apple-darwin', platform: 'darwin-arm64', go: 'darwin_arm64', pie: 'arm64-darwin-bsdlibc' },
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
*polyspec-fsm-wasm*) mkdir -p "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release" && printf 'wasm\\n' > "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/polyspec_fsm_wasm.wasm" ;;
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
  program(path.join(bin, 'php-config'), record);
  // The napi CLI of the root package.json, by its bin link: build writes the addon of the platform of --target into
  // --output-dir, create-npm-dirs writes the package of each platform of the configuration into --npm-dir, and artifacts
  // copies the addon into it. Each records the configuration that --config-path names.
  program(path.join(dir, 'node_modules/.bin/napi'), `${record}option() { while [ $# -gt 1 ] && [ "$1" != "$name" ]; do shift; done; [ "$1" = "$name" ] && printf '%s' "$2"; }
platform() { case "$1" in
x86_64-unknown-linux-gnu) echo linux-x64-gnu ;; aarch64-unknown-linux-gnu) echo linux-arm64-gnu ;; aarch64-apple-darwin) echo darwin-arm64 ;; esac; }
command=$1
name=--config-path; config=$(option "$@")
[ -n "$config" ] && printf 'napi-config\\t%s\\n' "$(cat "$config")" >> '${calls}'
name=--output-dir; addons=$(option "$@")
name=--npm-dir; npm=$(option "$@")
case "$command" in
build) name=--target; triple=$(option "$@"); mkdir -p "$addons" && printf 'addon\\n' > "$addons/fsm.$(platform "$triple").node" ;;
create-npm-dirs) for triple in $(sed 's/.*\\[//; s/\\].*//; s/[",]/ /g' "$config"); do p=$(platform "$triple"); mkdir -p "$npm/$p"; printf '{"name":"@polyspec/fsm-%s","version":"0.0.13","main":"fsm.%s.node","files":["fsm.%s.node"]}\\n' "$p" "$p" "$p" > "$npm/$p/package.json"; done ;;
artifacts) for folder in "$npm"/*; do cp "$addons/fsm.$(basename "$folder").node" "$folder/"; done ;;
*) exit 9 ;;
esac
`);
  // The wasm-bindgen of WASM_BINDGEN: it prints the release of packages/ts/wasm/Cargo.toml and writes the files of the binding.
  program(path.join(bin, 'wasm-bindgen'), `${record}case "$1" in --version) echo 'wasm-bindgen 0.2.999'; exit 0 ;; esac
while [ "$1" != --out-dir ]; do shift; done
mkdir -p "$2" && for file in fsm_wasm.js fsm_wasm.d.ts fsm_wasm_bg.wasm; do printf 'bound\\n' > "$2/$file"; done
`);
  // The npm package of the bindings, with the generated files that the generation of the Node and the WASM binding write.
  for (const file of ['packages/ts/package.json', 'packages/ts/wasm/Cargo.toml']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  }
  copyFileSync(path.join(ROOT, 'packages/ts/package.json'), path.join(dir, 'packages/ts/package.json'));
  writeFileSync(path.join(dir, 'packages/ts/wasm/Cargo.toml'), '[dependencies]\nwasm-bindgen = "=0.2.999"\n');
  for (const file of ['generated/index.cjs', 'generated/index.mjs', 'generated/index.d.ts', 'wasm/generated/index.mjs', 'wasm/generated/index.d.ts', 'wasm/generated/state.mjs', 'wasm/generated/lib.rs']) {
    mkdirSync(path.dirname(path.join(dir, 'packages/ts', file)), { recursive: true });
    writeFileSync(path.join(dir, 'packages/ts', file), `${file}\n`);
  }
  // The git of PATH records a push and runs the git of the system for every other command.
  program(path.join(bin, 'git'), `case "$1" in push) ${record}exit 0 ;; esac\nexec /usr/bin/git "$@"\n`);
  // A generator of the command line: it records its arguments and the folders of the libraries, and prints the reference
  // that the case names in the file ref.
  writeFileSync(path.join(tmp, 'binding.mjs'), `import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, ['binding', ...args].join('\\t') + '\\n');
const libraries = args[args.indexOf('--libraries') + 1];
appendFileSync(${JSON.stringify(calls)}, ['libraries', ...(existsSync(libraries) ? readdirSync(libraries).sort() : [])].join('\\t') + '\\n');
const ref = ${JSON.stringify(path.join(tmp, 'ref'))};
if (existsSync(ref)) process.stdout.write(readFileSync(ref, 'utf8'));
process.exit(existsSync(${JSON.stringify(path.join(tmp, 'fails'))}) ? 1 : 0);
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

// The generation of the PHP binding is a prerequisite of the extension; a case marks it as done, so make runs the recipe alone.
const GENERATED_PHP = ['-o', 'bindings-php'];

test('release-php-ext builds, loads and packs the PHP extension under the name by which PIE finds it', async t => {
  for (const { triple, pie } of PLATFORMS) {
    for (const php of [{ minor: '8.4' }, { minor: '8.5', zts: true }, { minor: '8.3', debug: true, zts: true }] as Php[]) {
      const build = `${php.debug ? '-debug' : ''}-${php.zts ? 'zts' : 'nts'}`;
      await t.test(`${triple} php${php.minor}${build}`, t2 => {
        const box = sandbox(t2, triple, false, php);
        const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${box.php}`]);
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
  const config = path.join(path.dirname(box.dir), 'other/php-config');
  program(config, '');
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${box.php}`, `PHP_CONFIG=${config}`, 'RELEASE_ASSETS=out/assets']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(existsSync(path.join(box.dir, 'out/assets/php-ext/php_polyspec_fsm-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip')));
  assert.ok(box.calls().some(call => call[0] === 'cargo' && call[3] === `PHP_CONFIG=${config}`), JSON.stringify(box.calls()));
});

test('release-php-ext gives cargo the absolute paths of a PHP and a php-config that are named relative to the checkout', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  // The build script of ext-php-rs refuses a PHP that it cannot find by the path that PHP names.
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', 'PHP=../bin/php']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const real = realpathSync(box.dir);
  assert.ok(box.calls().some(call => call[0] === 'cargo' && call[2] === `PHP=${real}/../bin/php` && call[3] === `PHP_CONFIG=${real}/../bin/php-config`), JSON.stringify(box.calls()));
});

test('release-php-ext generates the PHP binding first, so that a checkout without generated files builds', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  // The install of the generator is keyed on the root Cargo.lock, which the copy of the Makefile holds empty.
  writeFileSync(path.join(box.dir, 'Cargo.lock'), '');
  const ran = make(box, ['-n', 'release-php-ext', `PHP=${box.php}`]);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const lines = ran.stdout.split('\n');
  const generate = lines.findIndex(line => / generate --root \S+ --target php$/.test(line));
  const build = lines.findIndex(line => line.includes('cargo build --release --locked -p polyspec-fsm-php-ext'));
  assert.ok(generate >= 0 && build > generate, ran.stdout);
});

test('release-php-ext packs nothing when the extension does not load', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu', false, { minor: '8.4', loadFails: true });
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${box.php}`]);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter(call => call[0] === 'zip'), []);
  assert.equal(existsSync(path.join(box.dir, 'var/release/assets/php-ext')), false);
});

test('release-php-ext fails with 2 without PHP, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: PHP is required, for example make release-php-ext PHP=php/);
  assert.deepEqual(box.calls(), []);
});

test('release-php-ext fails with 2 on a host that is no platform of the release, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-apple-darwin');
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${box.php}`]);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: the host x86_64-apple-darwin is no platform of the release/);
  assert.deepEqual(box.calls().filter(call => call[0] !== 'rustc'), []);
});

// ---- release-npm-platform and release-npm (GN-19e, GN-3c, S-470-7) ---------------------------------------------------------

// The generation of the Node and the WASM binding are prerequisites; a case marks them as done, so make runs the recipe alone.
const GENERATED_NODE = ['-o', 'bindings-node', '-o', 'bindings-wasm'];

/** The files of the npm archive `file` and the text of its package.json. */
function archive(file: string): { files: string[]; manifest: Record<string, unknown> } {
  const files = spawnSync('tar', ['-tzf', file], { encoding: 'utf8' }).stdout.split('\n').filter(line => line !== '').sort();
  const manifest = JSON.parse(spawnSync('tar', ['-xzOf', file, 'package/package.json'], { encoding: 'utf8' }).stdout) as Record<string, unknown>;
  return { files, manifest };
}

test('release-npm-platform builds the addon of the host with the napi CLI and packs its platform package', async t => {
  for (const { triple, platform } of PLATFORMS) {
    await t.test(triple, t2 => {
      const box = sandbox(t2, triple);
      const ran = make(box, [...GENERATED_NODE, 'release-npm-platform']);
      assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
      const assets = path.join(box.dir, 'var/release/assets/npm');
      assert.equal(spawnSync('ls', ['-A', assets], { encoding: 'utf8' }).stdout, `polyspec-fsm-${platform}-0.0.13.tgz\n`);
      const { files, manifest } = archive(path.join(assets, `polyspec-fsm-${platform}-0.0.13.tgz`));
      assert.deepEqual(files, [`package/fsm.${platform}.node`, 'package/package.json']);
      assert.equal(manifest.name, `@polyspec/fsm-${platform}`);
      const work = path.join(realpathSync(box.dir), 'var/release/target/npm', platform);
      const napi = box.calls().filter(call => call[0] === 'napi');
      assert.deepEqual(napi, [
        ['napi', 'build', '--platform', '--release', '--no-js', '--manifest-path', 'packages/ts/Cargo.toml', '--package-json-path', 'packages/ts/package.json', '--target-dir', 'var/release/target', '--output-dir', `${work}/addons`, '--target', triple, '--', '--locked'],
        ['napi', 'create-npm-dirs', '--package-json-path', 'packages/ts/package.json', '--config-path', `${work}/napi.json`, '--npm-dir', `${work}/npm`],
        ['napi', 'artifacts', '--package-json-path', 'packages/ts/package.json', '--config-path', `${work}/napi.json`, '--output-dir', `${work}/addons`, '--npm-dir', `${work}/npm`],
      ]);
      // The configuration of the run names the triple of the host alone.
      assert.deepEqual(box.calls().filter(call => call[0] === 'napi-config'), [['napi-config', `{"targets":["${triple}"]}`], ['napi-config', `{"targets":["${triple}"]}`]]);
    });
  }
});

test('release-npm-platform fails with 2 on a host that is no platform of the release, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-unknown-freebsd');
  const ran = make(box, [...GENERATED_NODE, 'release-npm-platform']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-npm-platform: the host x86_64-unknown-freebsd is no platform of the release/);
  assert.deepEqual(box.calls().filter(call => call[0] !== 'rustc'), []);
});

test('release-npm packs @polyspec/fsm with the platform packages in optionalDependencies of a copy of its manifest', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, [...GENERATED_NODE, 'release-npm', `WASM_BINDGEN=${path.join(path.dirname(box.php), 'wasm-bindgen')}`]);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const assets = path.join(box.dir, 'var/release/assets/npm');
  assert.equal(spawnSync('ls', ['-A', assets], { encoding: 'utf8' }).stdout, 'polyspec-fsm-0.0.13.tgz\n');
  const { files, manifest } = archive(path.join(assets, 'polyspec-fsm-0.0.13.tgz'));
  assert.deepEqual(files, [
    'package/generated/index.cjs', 'package/generated/index.d.ts', 'package/generated/index.mjs', 'package/package.json',
    'package/wasm/generated/fsm_wasm.d.ts', 'package/wasm/generated/fsm_wasm.js', 'package/wasm/generated/fsm_wasm_bg.wasm',
    'package/wasm/generated/index.d.ts', 'package/wasm/generated/index.mjs', 'package/wasm/generated/state.mjs',
  ]);
  assert.deepEqual(manifest.optionalDependencies, { '@polyspec/fsm-linux-x64-gnu': '0.0.13', '@polyspec/fsm-linux-arm64-gnu': '0.0.13', '@polyspec/fsm-darwin-arm64': '0.0.13' });
  // The tracked manifest names no platform package.
  assert.equal(JSON.parse(readFileSync(path.join(box.dir, 'packages/ts/package.json'), 'utf8')).optionalDependencies, undefined);
  assert.deepEqual(box.calls().filter(call => call[0] === 'cargo'), [
    ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-fsm-wasm', '--target', 'wasm32-unknown-unknown'],
    ['cargo', 'CARGO_TARGET_DIR=var/release/target', 'PHP=', 'PHP_CONFIG='],
  ]);
});

test('release-npm fails with 2 with an empty WASM_BINDGEN, and builds nothing', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, [...GENERATED_NODE, 'release-npm', 'WASM_BINDGEN=']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-npm needs WASM_BINDGEN/);
  assert.deepEqual(box.calls(), []);
});

test('release-npm-platform and release-npm generate the Node binding first', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  writeFileSync(path.join(box.dir, 'Cargo.lock'), '');
  for (const target of ['release-npm-platform', 'release-npm']) {
    const ran = make(box, ['-n', target, 'WASM_BINDGEN=wasm-bindgen']);
    assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
    assert.ok(/ generate --root \S+ --target node$/m.test(ran.stdout), ran.stdout);
  }
});

// ---- release-go-module (GN-19f, S-470-8) -----------------------------------------------------------------------------------

/** Runs release-go-module in the sandbox with the generator of the case, which prints `ref` and fails when `fails`. */
function releaseGoModule(box: Sandbox, args: string[], ref: string | undefined, fails = false): ReturnType<typeof spawnSync<string>> {
  const tmp = path.dirname(box.dir);
  if (ref !== undefined) writeFileSync(path.join(tmp, 'ref'), ref);
  if (fails) writeFileSync(path.join(tmp, 'fails'), '');
  for (const { go } of PLATFORMS) {
    mkdirSync(path.join(box.dir, 'var/release/assets/go', go), { recursive: true });
  }
  return make(box, ['-o', 'bindings-go', 'release-go-module', `BINDING=${path.join(tmp, 'binding.mjs')}`, ...args]);
}

test('release-go-module makes the commit and the tag of the Go module with binding and pushes the reference that it prints', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/tags/packages/go/v1.2.3\n');
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const real = realpathSync(box.dir);
  assert.deepEqual(box.calls().filter(call => call[0] === 'binding' || call[0] === 'libraries' || call[0] === 'git'), [
    ['binding', 'release-go-module', '--root', real, '--tag', 'v1.2.3', '--libraries', `${real}/var/release/assets/go`, '--work', `${real}/var/release/target/go-module`],
    ['libraries', 'darwin_arm64', 'linux_amd64', 'linux_arm64'],
    ['git', 'push', 'origin', 'refs/tags/packages/go/v1.2.3'],
  ]);
});

test('release-go-module pushes nothing when the remote holds the tag already', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], '');
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /release-go-module: the remote holds the tag packages\/go\/v1\.2\.3 already/);
  assert.deepEqual(box.calls().filter(call => call[0] === 'git'), []);
});

test('release-go-module pushes nothing when binding fails', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/tags/packages/go/v1.2.3\n', true);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter(call => call[0] === 'git'), []);
});

test('release-go-module refuses an output that is not the reference of the tag, and pushes nothing', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/heads/main\n');
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-module: binding printed refs\/heads\/main, not refs\/tags\/packages\/go\/v1\.2\.3/);
  assert.deepEqual(box.calls().filter(call => call[0] === 'git'), []);
});

test('release-go-module fails with 2 without TAG, and runs nothing', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, [], 'refs/tags/packages/go/v1.2.3\n');
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-module: TAG is required, for example make release-go-module TAG=v0\.0\.1/);
  assert.deepEqual(box.calls(), []);
});

test('release-go-module generates the Go binding first', t => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  writeFileSync(path.join(box.dir, 'Cargo.lock'), '');
  const ran = make(box, ['-n', 'release-go-module', 'TAG=v1.2.3']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const lines = ran.stdout.split('\n');
  const generate = lines.findIndex(line => / generate --root \S+ --target go$/.test(line));
  const release = lines.findIndex(line => line.includes(' release-go-module --root '));
  assert.ok(generate >= 0 && release > generate, ran.stdout);
});

// ---- The wasm-bindgen CLI (S-470-9) ----------------------------------------------------------------------------------------

test('WASM_BINDGEN is the shim of the wasm-bindgen that mise installs into the checkout', t => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['-n', '-o', 'bindings-node', '-o', 'bindings-wasm', 'release-npm']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(ran.stdout.includes(`test "$(${realpathSync(box.dir)}/var/tools/mise/shims/wasm-bindgen --version)" = "wasm-bindgen `), ran.stdout);
});

test('the wasm-bindgen of mise.toml and mise.lock is the release of the wasm-bindgen crate of packages/ts/wasm and Cargo.lock', () => {
  const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
  const crate = /^wasm-bindgen = "=([^"]+)"$/m.exec(read('packages/ts/wasm/Cargo.toml'))?.[1];
  const locked = /^name = "wasm-bindgen"\nversion = "([^"]+)"$/m.exec(read('Cargo.lock'))?.[1];
  const tool = /^"github:wasm-bindgen\/wasm-bindgen" = "([^"]+)"$/m.exec(read('mise.toml'))?.[1];
  const lock = /^\[\[tools\."github:wasm-bindgen\/wasm-bindgen"\]\]\nversion = "([^"]+)"$/m.exec(read('mise.lock'))?.[1];
  assert.ok(crate !== undefined, 'packages/ts/wasm/Cargo.toml pins no wasm-bindgen with =');
  assert.deepEqual({ cargoLock: locked, miseToml: tool, miseLock: lock }, { cargoLock: crate, miseToml: crate, miseLock: crate });
});
