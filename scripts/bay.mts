#!/usr/bin/env node
// How the scripts of this repository start bay, and the installation of bay on a runner of CI (docs/plans/fsm-v1/plan.md,
// C-6; docs/plans/fsm-v1/checklist.md, S-475-4, S-475-5).
//
//   node scripts/bay.mts install   downloads, verifies and installs the release of bay that config/toolchain.json names
//
// bay is a tool that the machine gives, as make is. A script uses the bay of its machine as it is and compares no release:
// what changes its result is the contract of the output that it reads, so requireBay checks the schema of that contract and
// nothing else. The words that start bay come from the variable BAY, which is `bay` when it is not set: the one who starts
// a run on a machine sets it, because it states a fact of that machine. On a runner of GitHub the state of bay belongs to
// root and the user of a job has sudo without a password, so the job sets it to `sudo -n bay`.
//
// install is for a runner of CI, which holds no bay and so must download one; a download is used only with its pinned
// digest, and config/toolchain.json names the release and the sha256 of the archive of each platform. It downloads the
// archive of the platform with curl, fails unless its sha256 is the pinned one, extracts it under var/tools/bay, installs
// bay and bayd into /usr/local/bin with sudo -n, applies the machine setup with bay install, requires bay check -scope run,
// and fails unless the installed bay prints the version that it installed. As root the setup asks nothing; on a machine of
// development a person installs bay, because there the setup asks for the administrator password.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PIN = 'config/toolchain.json';
// The schema of the contract of bay for which the scripts of this repository are written: its commands, its Compose keys
// and the fields of its JSON.
const SCHEMA = 1;
const USAGE = 'usage: scripts/bay.mts install';

/** A failure of a command of bay that ends the script with `code` and the message on standard error. */
export class BayError extends Error {
  code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a directory of PATH holds the executable file `name`. */
function onPath(name: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).filter(directory => directory !== '').some(directory => {
    try {
      accessSync(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The words that start bay: those of the variable BAY, or `bay` when it is not set or empty. */
export function bayWords(): string[] {
  const words = (process.env.BAY ?? '').split(' ').filter(word => word !== '');
  return words.length > 0 ? words : ['bay'];
}

/** Runs bay with `args`, its output kept, and returns its standard output; fails when it did not start or ended with another code than 0. */
export function bayOutput(args: readonly string[]): string {
  const [program = 'bay', ...words] = bayWords();
  const ran = spawnSync(program, [...words, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error) throw new BayError(`scripts/bay.mts: ${program}: ${ran.error.message}`);
  if (ran.status !== 0) throw new BayError(`scripts/bay.mts: bay ${args.join(' ')} ended with ${String(ran.status ?? ran.signal)}:\n${ran.stderr}${ran.stdout}`.trimEnd());
  return ran.stdout;
}

/** What `bay version --json` prints: its text, and the version and the schema of the contract that it names. */
interface Version {
  text: string;
  version: unknown;
  schema: unknown;
}

/** Fails at once unless PATH holds the program that starts bay, and returns what `bay version --json` prints. */
export function bayVersion(): Version {
  const [program = 'bay'] = bayWords();
  if (!onPath(program)) throw new BayError(`scripts/bay.mts: ${program} is not found on PATH: install bay and apply its machine setup with bay install`);
  const text = bayOutput(['version', '--json']).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BayError(`scripts/bay.mts: bay version --json printed no JSON:\n${text}`);
  }
  return { text, version: isRecord(parsed) ? parsed.version : undefined, schema: isRecord(parsed) ? parsed.schemaVersion : undefined };
}

/** Fails unless the contract of the bay of `version` is the schema that the scripts of this repository read. No release is compared. */
export function requireContract(version: Version): void {
  if (version.schema !== SCHEMA) throw new BayError(`scripts/bay.mts: the contract of bay is the schema ${String(version.schema)}, and the scripts of this repository read the schema ${String(SCHEMA)}`);
}

/** Runs `program` with `args`, its output on that of the script; fails when it did not start or ended with another code than 0. */
function run(program: string, args: readonly string[]): void {
  const ran = spawnSync(program, args, { stdio: 'inherit' });
  if (ran.error) throw new BayError(`scripts/bay.mts: ${program}: ${ran.error.message}`);
  if (ran.status !== 0) throw new BayError(`scripts/bay.mts: ${program} ${args.join(' ')} ended with ${String(ran.status ?? ran.signal)}`);
}

/** Installs the release of bay that config/toolchain.json names for the platform of this process. */
function install(): void {
  const toolchain: unknown = JSON.parse(readFileSync(path.join(ROOT, PIN), 'utf8'));
  const pin = isRecord(toolchain) ? toolchain.bay : undefined;
  const version = isRecord(pin) ? pin.version : undefined;
  const digests = isRecord(pin) ? pin.sha256 : undefined;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || !isRecord(digests)) throw new BayError(`scripts/bay.mts: ${PIN} names no release of bay with its sha256`);
  // The platform as the pin names it, and as the archives of a release of bay name it.
  const platform = `${process.platform}-${process.arch}`;
  const pinned = digests[platform];
  if (typeof pinned !== 'string' || !/^[0-9a-f]{64}$/.test(pinned)) throw new BayError(`scripts/bay.mts: ${PIN} names no sha256 of bay for ${platform}`);
  const name = `bay_v${version}_${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const directory = path.join(ROOT, 'var/tools/bay');
  const archive = path.join(directory, `${name}.tar.gz`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  run('curl', ['-fsSL', '-o', archive, `https://github.com/polyspec/bay/releases/download/v${version}/${name}.tar.gz`]);
  const found = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (found !== pinned) {
    rmSync(archive, { force: true });
    throw new BayError(`scripts/bay.mts: the sha256 of ${archive} is ${found}, and ${PIN} pins ${pinned} for ${platform}`);
  }
  run('tar', ['-xzf', archive, '-C', directory]);
  run('sudo', ['-n', 'install', '-m', '755', path.join(directory, name, 'bay'), path.join(directory, name, 'bayd'), '/usr/local/bin/']);
  const [program = 'bay', ...words] = bayWords();
  run(program, [...words, 'install']);
  run(program, [...words, 'check', '-scope', 'run']);
  const installed = bayVersion();
  if (installed.version !== `v${version}`) throw new BayError(`scripts/bay.mts: bay is ${String(installed.version)}, and ${PIN} pins v${version}: install the release https://github.com/polyspec/bay/releases/tag/v${version}`);
  process.stdout.write(`scripts/bay.mts: installed bay ${installed.text}\n`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 1 || args[0] !== 'install') throw new BayError(USAGE, 2);
    install();
  } catch (error) {
    if (!(error instanceof BayError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  }
}
