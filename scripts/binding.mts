#!/usr/bin/env node
// Installs and runs binding, the generator of the binding packages, at the commit of polyspec-binding-core that the root
// Cargo.lock pins (docs/plans/fsm-v1/checklist.md, S-477).
//
//   node scripts/binding.mts install <npm>
//   node scripts/binding.mts <check|scaffold|generate> [arguments]
//
// Before its first release binding is a Git dependency of the root Cargo workspace, and only its crate
// polyspec-binding-core is a Cargo package; the command-line tool is the TypeScript package packages/ts of the same
// repository, which no package registry holds yet. So the tool comes from the checkout that Cargo made of the pinned
// commit: `install` clones that checkout into var/binding/<commit> and installs there, with the npm `<npm>`, the
// dependencies that the package-lock.json of the tool pins. The clone is a Git checkout of binding at that commit, which
// is how binding check knows its own commit and compares it with the commit of Cargo.lock; a copy of the files alone has
// no commit. The commit is that of Cargo.lock, so the generator and polyspec-binding-core are one version. Every other
// command runs the tool of that folder with its arguments and ends with the exit code of the tool; it installs nothing,
// and it fails with the target that installs when the folder is missing. This way to install a tool ends when binding is
// a package that a lock of the repository pins.
import { execFile, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');
// The folder of a commit of the generator, and the file that npm writes last when an install of its packages succeeds.
const TOOLS = 'var/binding';
const INSTALLED = 'packages/ts/node_modules/.package-lock.json';
const CORE = 'polyspec-binding-core';

/** The pinned generator: its commit and the checkout that Cargo made of it. */
export interface Pinned {
  readonly commit: string;
  readonly checkout: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The commit of polyspec-binding-core and the checkout of its repository, from the output of `cargo metadata`; throws when
 * the lock holds no such Git dependency. The crate is packages/core/rust of the binding repository.
 */
export function pinned(metadata: unknown): Pinned {
  const packages = isRecord(metadata) ? metadata.packages : undefined;
  if (!Array.isArray(packages)) throw new Error('cargo metadata gave no list of packages');
  const core: unknown = packages.find((entry: unknown) => isRecord(entry) && entry.name === CORE);
  const source = isRecord(core) ? core.source : undefined;
  const manifest = isRecord(core) ? core.manifest_path : undefined;
  if (typeof source !== 'string' || typeof manifest !== 'string') throw new Error(`Cargo.lock has no Git dependency ${CORE}`);
  const commit = /^git\+.*#([0-9a-f]{40})$/.exec(source)?.[1];
  if (commit === undefined) throw new Error(`${CORE} has no pinned commit: ${source}`);
  return { commit, checkout: path.resolve(path.dirname(manifest), '../../..') };
}

/** The folder of the generator of `commit` under the checkout `root`. */
export function toolFolder(root: string, commit: string): string {
  return path.join(root, TOOLS, commit);
}

/** Whether the generator of `commit` is installed under `root`: its clone and the packages of its lock. */
export function isInstalled(root: string, commit: string): boolean {
  return existsSync(path.join(toolFolder(root, commit), INSTALLED));
}

/** Runs `command` with its output on the terminal and gives its exit code; a command that a signal ends is an error. */
function run(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (exit, signal) => {
      if (signal !== null) reject(new Error(`${command} ${args.join(' ')} was ended by ${signal}`));
      else resolve(exit ?? 1);
    });
  });
}

/** Runs `command` and throws when it does not end with 0. */
async function must(command: string, args: readonly string[], cwd: string): Promise<void> {
  const code = await run(command, args, cwd);
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} ended with ${code}`);
}

/** The pinned generator of the Cargo workspace of `root`, which cargo resolves from Cargo.lock. */
async function pinnedOf(root: string): Promise<Pinned> {
  // The metadata of a workspace with the binding crates passes the default buffer of one megabyte.
  const { stdout } = await promisify(execFile)('cargo', ['metadata', '--format-version', '1', '--locked', '--manifest-path', path.join(root, 'Cargo.toml')], { maxBuffer: 1 << 28 });
  const metadata: unknown = JSON.parse(stdout);
  return pinned(metadata);
}

/** Clones the checkout of the pinned commit into its folder and installs the packages of the lock of the tool with `npm`. */
async function install(root: string, { commit, checkout }: Pinned, npm: string): Promise<void> {
  if (isInstalled(root, commit)) return;
  const tool = toolFolder(root, commit);
  rmSync(tool, { recursive: true, force: true });
  await must('git', ['clone', '--quiet', '--no-checkout', checkout, tool], root);
  await must('git', ['-C', tool, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', commit], root);
  await must(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], path.join(tool, 'packages/ts'));
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || (command === 'install' && rest.length !== 1)) {
    process.stderr.write('usage: node scripts/binding.mts install <npm>\n       node scripts/binding.mts <check|scaffold|generate> [arguments]\n');
    process.exitCode = 2;
  } else {
    try {
      const pin = await pinnedOf(ROOT);
      if (command === 'install') {
        await install(ROOT, pin, path.resolve(rest[0] ?? ''));
      } else if (!isInstalled(ROOT, pin.commit)) {
        throw new Error(`${path.join(TOOLS, pin.commit)} holds no installed generator; run make binding-install`);
      } else {
        process.exitCode = await run(process.execPath, [path.join(toolFolder(ROOT, pin.commit), 'packages/ts/src/cli.ts'), command, ...rest], ROOT);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      process.stderr.write(`[binding] ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
