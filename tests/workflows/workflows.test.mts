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

// The workflows among the copies of kit (kit.copies of the installed @polyspec/kit: ci-pipeline.yml and release.yml) belong to kit: make kit-check keeps them
// byte for byte, so the rules of fsm's own workflows below do not read them.
const KIT_PACKAGE: unknown = JSON.parse(read('node_modules/@polyspec/kit/package.json'));
const COPIES = field(field(KIT_PACKAGE, 'kit', '@polyspec/kit package.json'), 'copies', '@polyspec/kit package.json kit');
if (!isRecord(COPIES)) throw new Error('kit.copies of @polyspec/kit package.json must be an object');
const VENDORED = Object.keys(COPIES).filter(file => file.startsWith('.github/workflows/'));
const WORKFLOWS = readdirSync(path.join(ROOT, '.github/workflows')).filter(name => name.endsWith('.yml')).sort().map(name => `.github/workflows/${name}`)
  .filter(file => !VENDORED.includes(file));
const CI = read('.github/workflows/ci.yml');
const PAGES = read('.github/workflows/pages.yml');
const PLAN = read('docs/plans/fsm-v1/plan.md');
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

// The targets of every make command in a job, in order. Comment lines are not commands.
function makeTargets(jobText: string): string[] {
  return jobText
    .split('\n')
    .filter(line => !/^\s*#/.test(line) && !/^\s*-?\s*name:/.test(line))
    .flatMap(line => [...line.matchAll(/\bmake\s+([^\s"'$]+)/g)].map(match => text(match[1], 'the target of a make command')));
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
const PAGES_JOB = job(jobsOf(PAGES), 'pages');
const CHECK_JOB = job(ci, 'check');

// ubuntu-26.04: orm's PHP client requires SQLite 3.46, and the PHP of ubuntu-24.04 links its system SQLite 3.45.1 (S-21-1).
test('the CI workflow runs the kit pipeline, then its job check, on ubuntu-26.04 (K910)', () => {
  assert.deepEqual([...ci.keys()], ['kit', 'check']);
  assert.match(ci.get('kit') ?? '', /^ {4}uses: \.\/\.github\/workflows\/ci-pipeline\.yml$/m);
  assert.match(CHECK_JOB, /^ {4}needs: kit$/m);
  assert.match(CHECK_JOB, /^ {4}runs-on: ubuntu-26\.04$/m);
  assert.match(PAGES_JOB, /^ {4}runs-on: ubuntu-26\.04$/m);
});

test('the rules read the own workflows of fsm, ci.yml and pages.yml, and not the ci-pipeline and release workflows that kit vendors', () => {
  assert.deepEqual(VENDORED, ['.github/workflows/release.yml', '.github/workflows/ci-pipeline.yml']);
  assert.deepEqual(WORKFLOWS, ['.github/workflows/ci.yml', '.github/workflows/pages.yml']);
});

test('both workflows run on push to main and on workflow_dispatch', () => {
  for (const text of [CI, PAGES]) {
    assert.match(text, /\non:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/);
  }
});

test('both workflows have contents: read, RUSTUP_AUTO_INSTALL 0 and a concurrency group without cancel', () => {
  for (const text of [CI, PAGES]) {
    assert.match(text, /\npermissions:\n {2}contents: read\n/);
    assert.match(text, /\nconcurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false\n/);
  }
  assert.match(CI, /\nenv:\n {2}RUSTUP_AUTO_INSTALL: '0'\n/);
});

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

test('the check job installs kit, then runs make install, the playwright dependencies and make ci-targets, and no other make target', () => {
  assert.deepEqual(makeTargets(CHECK_JOB), ['install-tools', 'install-packages', 'install', 'ci-targets']);
  assert.match(CHECK_JOB, /make install-tools TOOLS=npm\n\s+make install-packages\n/, 'the check job installs the npm of packageManager and then @polyspec/kit (S-44)');
  const install = CHECK_JOB.indexOf('make install\n');
  const deps = CHECK_JOB.indexOf('install-deps chromium');
  const check = CHECK_JOB.indexOf('make ci-targets');
  assert.ok(install > 0 && deps > install && check > deps, 'the order must be make install, install-deps chromium, make ci-targets');
  const depsStep = step(stepsOf(CHECK_JOB), 'install-deps chromium');
  assert.match(depsStep, /sudo env PATH="\$PATH" npx playwright install-deps chromium/);
  assert.match(depsStep, /working-directory: packages\/gui/);
});

test('the pages job installs kit and then runs make docs-build only', () => {
  assert.deepEqual(makeTargets(PAGES_JOB), ['install-tools', 'install-packages', 'docs-build']);
});

test('the services and env of the check job are the lines of plan C-6, copied exactly', () => {
  const section = PLAN.split('CI services for S-21');
  assert.equal(section.length, 2, 'plan C-6 must hold one CI services block');
  const block = /```yaml\n([\s\S]*?)```/.exec(text(section[1], 'the text after CI services for S-21'))?.[1];
  assert.ok(block, 'plan C-6 has no yaml block after CI services for S-21');
  assert.ok(CHECK_JOB.includes(block), `the check job does not hold the block of plan C-6:\n${block}`);
});

test('the node, go, php and rust versions come from the files that declare them', () => {
  // Node.js is a tool of mise.toml (kit K171): setup-node reads it only for the node that starts the bootstrap.
  assert.match(CHECK_JOB, /\n {10}node-version-file: mise\.toml\n/);
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
// exists, and kit-check requires it of a repository that uses PHP (kit K193). Every setup-php step of fsm's own workflows
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

test('uv comes from mise.toml through make install, and the workflow installs no uv of its own (S-44-2, S-44-6)', () => {
  assert.equal(typeof miseTool('uv'), 'string', 'mise.toml must declare uv');
  assert.doesNotMatch(CHECK_JOB, /pipx|install uv/, 'the check job installs a uv of its own');
});

test('the check job uploads no artifact: the full-run record of make check is removed with the suite targets (S-342)', () => {
  assert.equal(stepsOf(CHECK_JOB).find(entry => entry.includes('upload-artifact')), undefined);
});

test('the pages workflow builds the site with VITEPRESS_BASE=/fsm/ and deploys docs/.vitepress/dist', () => {
  const build = stepsOf(PAGES_JOB).find(entry => entry.includes('make docs-build'));
  assert.ok(build, 'the pages job has no make docs-build step');
  assert.match(build, /VITEPRESS_BASE: \/fsm\//);
  assert.match(PAGES_JOB, /\n {6}pages: write\n/);
  assert.match(PAGES_JOB, /\n {6}id-token: write\n/);
  const upload = step(stepsOf(PAGES_JOB), 'upload-pages-artifact');
  assert.match(upload, /path: docs\/\.vitepress\/dist/);
  assert.ok(stepsOf(PAGES_JOB).some(entry => entry.includes('uses: actions/deploy-pages@')), 'the pages job has no deploy-pages step');
});

test('every action of the workflows is one of the verified pins, and the pages job uses the Pages actions', () => {
  assert.match(PAGES, /uses: actions\/configure-pages@/);
  assert.match(PAGES, /uses: actions\/upload-pages-artifact@/);
  assert.match(PAGES, /uses: actions\/deploy-pages@/);
});
