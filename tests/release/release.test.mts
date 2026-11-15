// The release recipes of the core and its bindings (docs/plans/fsm-v1/plan.md, C-11; binding GN-19 to GN-19h). The recipes of
// the platform assets are packages/release.mk, which binding release-recipes writes for the contract and tests itself (S-487):
// the Makefile includes that file and copies none of its recipes. These cases check what fsm owns: the include, the pins of
// the tools that the generated recipes start, and the step release-tag-output of the release workflow.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import napi from '@napi-rs/cli/package.json' with { type: 'json' };
import { cleanEnv } from '../support/make-sandbox.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/** The value at the keys `keys` of the JSON text `text`, or undefined where a key names no member of an object. */
function jsonAt(text: string, ...keys: string[]): unknown {
  let value: unknown = JSON.parse(text);
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return undefined;
    const member: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
    value = member;
  }
  return value;
}

// The targets of packages/release.mk (binding GN-19h), whose recipes no line of the Makefile writes (binding CK-94).
const GENERATED = ['release-go-static', 'release-wheel', 'release-php-ext', 'release-npm-platform', 'release-npm', 'release-go-module', 'release-binding-check', 'release-platform-assets', 'install-wasm-bindgen'];

test('the Makefile includes packages/release.mk after BINDING_RUN and BINDING_DEP and defines none of its recipes', () => {
  const makefile = read('Makefile');
  const include = makefile.indexOf('\n-include packages/release.mk\n');
  assert.ok(include > 0, 'the Makefile includes no packages/release.mk');
  for (const name of ['BINDING_RUN', 'BINDING_DEP']) {
    const definition = new RegExp(`^${name} :?= `, 'm').exec(makefile);
    assert.ok(definition !== null && definition.index < include, `the Makefile defines ${name} before the include`);
  }
  assert.deepEqual(GENERATED.filter(target => new RegExp(`^${target}:`, 'm').test(makefile)), []);
  assert.match(read('.gitignore'), /^\/packages\/release\.mk$/m, 'Git does not ignore packages/release.mk');
});

test('every job of assets.yml and release.yml that runs a generated recipe writes packages/release.mk first', () => {
  const makefile = read('Makefile');
  for (const job of ['ci-assets-platform', 'ci-assets-npm', 'ci-release-publish']) {
    const body = new RegExp(`^${job}:\\n((?:\\t.*\\n)+)`, 'm').exec(makefile)?.[1] ?? '';
    const lines = body.split('\n');
    const recipes = lines.findIndex(line => line.endsWith(' release-recipes'));
    const first = lines.findIndex(line => GENERATED.some(target => new RegExp(`\\b${target}\\b`).test(line)));
    assert.ok(recipes >= 0 && first > recipes, `${job} runs release-recipes before the first generated recipe:\n${body}`);
  }
});

test('the PHP minors of the extension are the PHP of .php-version, which the job platform builds', () => {
  const minors = jsonAt(read('config/toolchain.json'), 'phpExtension', 'minors');
  assert.deepEqual(minors, [read('.php-version').trim()]);
});

test('the toolchain holds the musl targets of the Go static libraries of a Linux host', () => {
  const targets = /^targets = \[(.*)\]$/m.exec(read('rust-toolchain.toml'))?.[1] ?? '';
  for (const target of ['wasm32-unknown-unknown', 'x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl']) assert.ok(targets.includes(`"${target}"`), `rust-toolchain.toml lacks ${target}`);
});

test('the wasm-bindgen of mise.toml and mise.lock is the release of the wasm-bindgen crate of packages/ts/wasm and Cargo.lock', () => {
  const crate = /^wasm-bindgen = "=([^"]+)"$/m.exec(read('packages/ts/wasm/Cargo.toml'))?.[1];
  const locked = /^name = "wasm-bindgen"\nversion = "([^"]+)"$/m.exec(read('Cargo.lock'))?.[1];
  const tool = /^"github:wasm-bindgen\/wasm-bindgen" = "([^"]+)"$/m.exec(read('mise.toml'))?.[1];
  const lock = /^\[\[tools\."github:wasm-bindgen\/wasm-bindgen"\]\]\nversion = "([^"]+)"$/m.exec(read('mise.lock'))?.[1];
  assert.ok(crate !== undefined, 'packages/ts/wasm/Cargo.toml pins no wasm-bindgen with =');
  assert.deepEqual({ cargoLock: locked, miseToml: tool, miseLock: lock }, { cargoLock: crate, miseToml: crate, miseLock: crate });
});

test('the napi CLI that the recipes run is the release that package.json pins', () => {
  const pinned = jsonAt(read('package.json'), 'devDependencies', '@napi-rs/cli');
  assert.equal(napi.version, pinned);
});

test('release-tag-output writes the tag and the version of the environment into the outputs of the step', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-release-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const output = path.join(dir, 'output');
  writeFileSync(output, 'earlier=1\n');
  const ran = spawnSync('make', ['--no-print-directory', 'release-tag-output'], { cwd: ROOT, encoding: 'utf8', env: { ...cleanEnv(), GITHUB_OUTPUT: output, TAG: 'v1.2.3', VERSION: '1.2.3' } });
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(readFileSync(output, 'utf8'), 'earlier=1\ntag=v1.2.3\nversion=1.2.3\n');
  const none = spawnSync('make', ['--no-print-directory', 'release-tag-output'], { cwd: ROOT, encoding: 'utf8', env: { ...cleanEnv(), GITHUB_OUTPUT: '' } });
  assert.equal(none.status, 2, `${none.stdout}${none.stderr}`);
  assert.match(none.stderr, /release-tag-output: GITHUB_OUTPUT is not set/);
});

test('every job that writes packages/release.mk installs the generator of the bindings first', () => {
  const makefile = read('Makefile');
  assert.match(makefile, /^\$\(foreach [^\n]* bindings-check release-recipes: \$\(if \$\(filter \$\(BINDING_SCRIPT\),\$\(BINDING\)\),\$\(BINDING_DEP\)\)$/m, 'release-recipes names BINDING_DEP after its definition');
  for (const job of ['ci-assets-platform', 'ci-assets-npm', 'ci-release-publish']) {
    const body = new RegExp(`^${job}:\\n((?:\\t.*\\n)+)`, 'm').exec(makefile)?.[1] ?? '';
    const lines = body.split('\n');
    const install = lines.findIndex(line => line.endsWith(' $(BINDING_DEP)'));
    const recipes = lines.findIndex(line => line.endsWith(' release-recipes'));
    assert.ok(install >= 0 && recipes > install, `${job} installs the generator (BINDING_DEP) before release-recipes:\n${body}`);
  }
});
