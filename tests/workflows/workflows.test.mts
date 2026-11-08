// Tests of the CI and Pages workflows (docs/plans/fsm-v1/plan.md, C-10 and Verification; docs/plans/fsm-v1/checklist.md, S-21).
// The workflows are read as text, so the test needs no YAML parser and no network. Each version is compared with the file
// that declares it, and the services and env of the CI job with the block that plan C-6 holds, so the plan and the workflow
// cannot drift apart. The action pins are the commits that the template repository verified for the same versions.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value of `key` of the object `value`, which `source` names; throws when `value` is no object. */
function field(value: unknown, key: string, source: string): unknown {
  if (!isRecord(value)) throw new Error(`${source} must be an object with ${key}`);
  return value[key];
}

/** `value` as a string; throws with `what` when it is another value. */
function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} must be a string`);
  return value;
}

// The pipeline and the release workflow, ci-pipeline.yml and release.yml, are the workflows that fsm took from the examples of
// kit (S-424); they keep the form of those examples, so the rules of the workflows that fsm wrote itself below do not read them.
const VENDORED = ['.github/workflows/release.yml', '.github/workflows/ci-pipeline.yml'];
const WORKFLOWS = readdirSync(path.join(ROOT, '.github/workflows')).filter(name => name.endsWith('.yml')).sort().map(name => `.github/workflows/${name}`)
  .filter(file => !VENDORED.includes(file));
const CI = read('.github/workflows/ci.yml');
const PAGES = read('.github/workflows/pages.yml');
// The bootstrap of every job is the kit-bootstrap action of fsm (K992); the jobs use it by its uses line.
const USES_KIT = 'uses: ./.github/actions/kit-bootstrap';
// The PHP minors of config/toolchain.json, the implementations of config/parity.json and the tools of mise.toml.
const PHP: unknown = field(JSON.parse(read('config/toolchain.json')), 'php', 'config/toolchain.json');
if (!Array.isArray(PHP)) throw new Error('php of config/toolchain.json must be a list');
const IMPLEMENTATIONS: unknown = field(JSON.parse(read('config/parity.json')), 'implementations', 'config/parity.json');
if (!Array.isArray(IMPLEMENTATIONS)) throw new Error('implementations of config/parity.json must be a list');
const MISE_TOOLS: unknown = parse(read('mise.toml')).tools;
/** The release of the tool `name` of mise.toml. */
const miseTool = (name: string): unknown => field(MISE_TOOLS, name, 'tools of mise.toml');

// The commits of the actions that these workflows use: those that the template repository verified (its action-pins test,
// T22.4-8), and checkout, setup-node and setup-php at the releases that kit pins in its release workflow (kit K169).
const VERIFIED = [
  { action: 'actions/checkout', version: 'v7.0.1', commit: '3d3c42e5aac5ba805825da76410c181273ba90b1' },
  { action: 'actions/configure-pages', version: 'v6.0.0', commit: '45bfe0192ca1faeb007ade9deae92b16b8254a0d' },
  { action: 'actions/deploy-pages', version: 'v5.0.1', commit: '368f82528645a54fb793d4d04e342629a3f51346' },
  { action: 'actions/setup-node', version: 'v7.1.0', commit: '949feb2413d6458794dcd2491c4babbbce0c15c1' },
  { action: 'actions/upload-artifact', version: 'v7.0.1', commit: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' },
  { action: 'actions/upload-pages-artifact', version: 'v5.0.0', commit: 'fc324d3547104276b827a68afc52ff2a11cc49c9' },
  { action: 'shivammathur/setup-php', version: '2.40.0', commit: 'eb7c497e18156a6bbabfef1d3a82760b9eda3962' },
];

// The jobs of a workflow: the text of each job under `jobs:`, from its name line to the next job.
function jobsOf(workflow: string): Map<string, string> {
  const body = workflow.split(/\njobs:\n/)[1];
  assert.ok(body, 'the workflow has no jobs: block');
  const jobs = new Map<string, string[]>();
  let lines: string[] | undefined;
  for (const line of body.split('\n')) {
    const name = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line)?.[1];
    if (name !== undefined) {
      lines = [];
      jobs.set(name, lines);
    } else if (lines) {
      lines.push(line);
    }
  }
  return new Map([...jobs].map(([job, lines]) => [job, lines.join('\n')]));
}

// The steps of a job: the text of each `- ` item of `steps:`.
function stepsOf(jobText: string): string[] {
  const [, steps = ''] = jobText.split(/\n {4}steps:\n/);
  return steps.split(/\n(?= {6}- )/).filter(step => step.trim());
}

/** The text of the job `name` of `jobs`; throws when the workflow has no such job. */
function job(jobs: Map<string, string>, name: string): string {
  return text(jobs.get(name), `the job ${name}`);
}

/** The step of `steps` that includes `part`; throws when there is none. */
function step(steps: string[], part: string): string {
  return text(steps.find(entry => entry.includes(part)), `the step with ${part}`);
}

const ci = jobsOf(CI);
const CHECK_JOB = job(ci, 'check');

test('every uses: is pinned to a full commit with the version comment of the verified commit', () => {
  const found: { where: string; action: string; commit: string; version: string | undefined }[] = [];
  for (const file of WORKFLOWS) {
    read(file).split('\n').forEach((line, index) => {
      const match = /uses:\s+([\w.-]+\/[\w.-]+)@(\S+)(?:\s+#\s*(\S+))?/.exec(line);
      if (match) found.push({ where: `${file}:${index + 1}`, action: text(match[1], 'the action of a uses: line'), commit: text(match[2], 'the ref of a uses: line'), version: match[3] });
    });
  }
  assert.ok(found.length > 0, 'no uses: line was found; the pin check verified nothing');
  const failures: string[] = [];
  for (const pin of found) {
    if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push(`${pin.where}: ${pin.action} is not pinned to a 40-character commit`);
    else if (!pin.version) failures.push(`${pin.where}: ${pin.action} has no version comment`);
    else if (!VERIFIED.some(entry => entry.action === pin.action && entry.commit === pin.commit && entry.version === pin.version)) {
      failures.push(`${pin.where}: ${pin.action}@${pin.commit} # ${pin.version} is not a verified pin`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the node, go, php and rust versions come from the files that declare them', () => {
  // Node.js is a tool of mise.toml (kit K171): setup-node reads it only for the node that starts the bootstrap.
  assert.ok(CHECK_JOB.includes(USES_KIT), 'the check job does not run the kit-bootstrap action');
  assert.doesNotMatch(CHECK_JOB, /node-version: /);
  assert.match(text(miseTool('node'), 'node of mise.toml'), /^\d+\.\d+\.\d+$/);

  // Go is a tool of mise.toml, which make install installs with mise (S-44-6): the workflow sets up no Go of its own, and the
  // go directive of the go kind's go.mod (the first root of the implementation go in config/parity.json) is that release.
  assert.doesNotMatch(CHECK_JOB, /setup-go|go-version/, 'the check job sets up a Go of its own');
  const goRoots = field(IMPLEMENTATIONS.find((implementation: unknown) => field(implementation, 'name', 'an implementation of config/parity.json') === 'go'), 'roots', 'the implementation go');
  if (!Array.isArray(goRoots)) throw new Error('roots of the implementation go must be a list');
  const goRoot = text(goRoots[0], 'the first root of the implementation go');
  const edit = spawnSync('go', ['mod', 'edit', '-json'], { cwd: path.join(ROOT, goRoot), encoding: 'utf8' });
  assert.equal(edit.status, 0, edit.stderr);
  const goMod: unknown = JSON.parse(edit.stdout);
  assert.equal(field(goMod, 'Go', 'go mod edit -json'), miseTool('go'), `the go directive of ${goRoot}/go.mod is the go of mise.toml`);
  assert.equal(field(goMod, 'Toolchain', 'go mod edit -json'), undefined, `${goRoot}/go.mod has no toolchain line (S-44-2)`);

  // The PHP of the check job is that of .php-version, which the next test compares with config/toolchain.json (S-44-20).
  assert.match(step(stepsOf(CHECK_JOB), 'shivammathur/setup-php'), /\n {10}php-version-file: \.php-version\n/);
  assert.match(CHECK_JOB, /\n {10}extensions: .*pdo_pgsql.*pdo_mysql|\n {10}extensions: .*pdo_mysql.*pdo_pgsql/);

  const rustChannel = /^channel = "(\d+\.\d+\.\d+)"$/m.exec(read('rust-toolchain.toml'))?.[1];
  assert.ok(rustChannel, 'rust-toolchain.toml must name an exact channel');
  // make install-tools of make install installs the channel, profile and components that rust-toolchain.toml names (kit
  // K151, S-44-16): the workflow runs no rustup of its own.
  assert.doesNotMatch(CHECK_JOB, /rustup/, 'the check job installs a Rust toolchain of its own');
  assert.ok(stepsOf(CHECK_JOB).some(entry => /\n\s+run: make install$/m.test(entry)), 'the check job runs no make install');
  assert.match(read('rust-toolchain.toml'), /^profile = "minimal"$/m);
  assert.match(read('rust-toolchain.toml'), /^components = \["clippy"\]$/m, 'rust-toolchain.toml names clippy, which kit\'s lint-rust runs');
});

// .php-version declares the PHP of the checkout for setup-php: the release workflow of kit sets up PHP only when the file
// exists. Every setup-php step of fsm's own workflows
// reads the same file, so the PHP of CI is one declaration that this test ties to config/toolchain.json (S-44-20).
test('.php-version holds the PHP minor of config/toolchain.json, and every setup-php step of the workflows reads it', () => {
  assert.equal(PHP.length, 1, 'config/toolchain.json must declare one PHP minor, the minimum that .php-version holds');
  assert.equal(read('.php-version'), `${text(PHP[0], 'the PHP minor of config/toolchain.json')}\n`);
  const setups = WORKFLOWS.flatMap(file => [...jobsOf(read(file))].flatMap(([name, body]) => stepsOf(body)
    .filter(entry => entry.includes('shivammathur/setup-php'))
    .map(entry => ({ where: `${file}, job ${name}`, entry }))));
  assert.ok(setups.length > 0, 'no workflow of fsm sets up PHP');
  for (const { where, entry } of setups) {
    assert.match(entry, /\n {10}php-version-file: \.php-version\n/, `${where}: setup-php does not read .php-version`);
    assert.doesNotMatch(entry, /\n {10}php-version: /, `${where}: setup-php names a PHP of its own`);
  }
});

test('every action of the workflows is one of the verified pins, and the pages job uses the Pages actions', () => {
  assert.match(PAGES, /uses: actions\/configure-pages@/);
  assert.match(PAGES, /uses: actions\/upload-pages-artifact@/);
  assert.match(PAGES, /uses: actions\/deploy-pages@/);
});
