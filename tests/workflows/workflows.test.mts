// Tests of the CI and Pages workflows (docs/plans/fsm-v1/plan.md, C-10 and Verification; docs/plans/fsm-v1/checklist.md, S-21).
// The workflows are read as text, so the test needs no YAML parser and no network. Each version is compared with the file
// that declares it. The CI job holds no block services and no variable of a server: it pulls the images of the PostgreSQL
// and MySQL servers and runs its suite through make persist-servers, which starts them in containers (plan C-6, S-472-1),
// and it uploads its report. The action pins are the commits that the template repository verified for the same versions.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { cleanEnv } from '../support/make-sandbox.mts';
import { standIns } from '../support/stand-ins.mts';

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

/** `value` as a list of strings; throws when it is another value. */
function words(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((word): word is string => typeof word === 'string')) throw new Error('the value must be a list of strings');
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
// The PHP minors of config/toolchain.json and the tools of mise.toml.
const PHP: unknown = field(JSON.parse(read('config/toolchain.json')), 'php', 'config/toolchain.json');
if (!Array.isArray(PHP)) throw new Error('php of config/toolchain.json must be a list');
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
// The one run step of the job check: the recipe ci-check holds its content (S-484), and on the runner bay starts through sudo
// -n, because its state belongs to root there (S-475-5).
const CHECK_RUN = 'make ci-check';

/**
 * The make calls of the recipe `make <goals>`, read from its dry run: the first word after each `make --no-print-directory` of
 * a line, in their order. The recipes of the jobs start make through CI_MAKE, so the dry run prints those calls and runs none.
 */
function callsOf(goals: string[], env: Record<string, string> = {}): string[] {
  const dry = make(['-n', ...goals], env);
  assert.equal(dry.code, 0, dry.output);
  return [...dry.output.matchAll(/\bmake --no-print-directory ([^\s;]+)/g)].map(match => text(match[1], 'a make call of a recipe'));
}

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
  // go directive of legacy/packages/go/go.mod is that release.
  assert.doesNotMatch(CHECK_JOB, /setup-go|go-version/, 'the check job sets up a Go of its own');
  const goRoot = 'legacy/packages/go';
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
  assert.equal(callsOf(['ci-check'])[0], 'install', 'the recipe of the check job does not run make install first');
  assert.match(read('rust-toolchain.toml'), /^profile = "minimal"$/m);
  // clippy is the lint that kit's lint-rust runs; llvm-tools holds llvm-strip, llvm-size and llvm-nm, which the release of the Go
  // module reads from the toolchain of the checkout (S-470-1).
  assert.match(read('rust-toolchain.toml'), /^components = \["clippy", "llvm-tools"\]$/m, 'rust-toolchain.toml does not name clippy and llvm-tools');
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

/** The targets that `make <goal>` gives to make ci-targets, read from its dry run: the suite of make check or of make ci-suite. */
function suiteOf(goal: string): string[] {
  const dry = make(['-n', goal]);
  assert.equal(dry.code, 0, dry.output);
  const targets = /^\S+\/node scripts\/persist-servers\.mts run -- \S*make ci-targets TARGETS="([^"]*)"$/m.exec(dry.output)?.[1];
  assert.ok(targets !== undefined, `make ${goal} does not run its targets through make persist-servers:\n${dry.output}`);
  return targets.split(' ').filter(Boolean);
}

// The workflow holds no list of targets of its own (S-474): the recipe of its job ends with make ci-suite, the suite of make
// check without the targets that the jobs of the pipeline run, so a target that an item adds to CHECK_TARGETS runs in CI and in
// make check.
test('the suite of the check job is make ci-suite: the targets of make check that no job of the pipeline runs', () => {
  const runs = stepsOf(CHECK_JOB).filter(entry => /\n {8}run: /.test(entry));
  assert.equal(runs.length, 1, `the check job has ${String(runs.length)} run steps`);
  assert.ok(text(runs[0], 'the run step of the check job').includes(`\n        run: ${CHECK_RUN}\n`) || String(runs[0]).endsWith(`\n        run: ${CHECK_RUN}`), `the run step of the check job is not ${CHECK_RUN}:\n${String(runs[0])}`);
  assert.equal(callsOf(['ci-check']).at(-1), 'ci-suite', 'the recipe of the check job does not end with make ci-suite');
  assert.doesNotMatch(CHECK_JOB, /TARGETS=/, 'the check job names targets of its own');
  const check = suiteOf('check');
  const own = suiteOf('ci-suite');
  assert.deepEqual(own.filter(target => !check.includes(target)), [], 'make ci-suite runs a target that make check does not run');
  assert.ok(check.includes('package-names-test'), 'make check does not run package-names-test');
  // A target of make check that the suite of the job leaves out is a target of a job of the pipeline: a static gate, or a
  // prerequisite of the gates of a runtime, by its own name or by a name whose one prerequisite it is.
  const makefile = read('Makefile');
  const gates = new Set(/^KIT_STATIC_GATES := (.*)$/m.exec(makefile)?.[1]?.split(' ') ?? []);
  for (const [, prerequisites = ''] of makefile.matchAll(/^kit-gates-runtime-[a-z-]+: (.*)$/gm)) {
    for (const name of prerequisites.split(' ')) {
      gates.add(name);
      const alias = new RegExp(`^${name}: ([a-z][a-z0-9-]*)$`, 'm').exec(makefile)?.[1];
      if (alias !== undefined) gates.add(alias);
    }
  }
  assert.ok(gates.size >= 9, `the Makefile names ${String(gates.size)} targets of the jobs of the pipeline`);
  assert.deepEqual(check.filter(target => !own.includes(target) && !gates.has(target)), [], 'a target of make check runs in no job of CI');
  assert.deepEqual(own.filter(target => gates.has(target)), [], 'make ci-suite runs a target that a job of the pipeline runs');
});

// A consumer takes the core crate from the tag of the repository (S-470-2): config/release.json classifies its manifest as
// git-tag, so the release requires its version, and no archive carries it.
test('the release holds the core crate by its tag', () => {
  const release: unknown = JSON.parse(read('config/release.json'));
  assert.equal(field(field(release, 'manifests', 'config/release.json'), 'packages/rust/Cargo.toml', 'manifests of config/release.json'), 'git-tag');
  const notReleased: unknown = field(release, 'notReleased', 'config/release.json');
  assert.ok(isRecord(notReleased) && !('packages/rust/Cargo.toml' in notReleased), 'packages/rust/Cargo.toml is in notReleased');
});

// The core crate packages/rust holds every rule of fsm (plan f6, step 3a), so its tests are a target of the suite of the CI job
// and of make check, and the owner check of its paths (S-457-1).
test('the suite of the CI job, make check and the owners of the core crate run its tests', () => {
  const suite = suiteOf('ci-suite');
  assert.ok(suite.includes('test-rust'), `the suite of the CI job does not run test-rust: ${suite.join(' ')}`);
  const check = suiteOf('check');
  assert.ok(check.includes('test-rust'), `make check does not run test-rust: ${check.join(' ')}`);
  const owners: unknown = field(JSON.parse(read('config/owner-checks.json')), 'owners', 'config/owner-checks.json');
  if (!Array.isArray(owners)) throw new Error('owners of config/owner-checks.json must be an array');
  const rules: unknown[] = owners;
  for (const owned of ['packages/rust/**', 'contracts/cases.json', 'Cargo.toml', 'Cargo.lock']) {
    const rule = rules.find((owner: unknown) => {
      const paths: unknown = field(owner, 'paths', 'an owner');
      const targets: unknown = field(owner, 'targets', 'an owner');
      return Array.isArray(paths) && paths.includes(owned) && Array.isArray(targets) && targets.includes('test-rust');
    });
    assert.ok(rule !== undefined, `no owner of ${owned} runs test-rust`);
  }
});

// The servers of the persist targets (plan C-6, S-472-1): the job declares no server and no DSN. Its step of the images
// downloads them, and its suite step is one make target that owns the containers of the run.
test('the check job holds no services and no DSN: it pulls the images and runs its suite through make persist-servers', () => {
  assert.doesNotMatch(CI, /^ *services:/m, 'ci.yml holds a block services');
  assert.doesNotMatch(CI.split('\n').filter(line => !line.trim().startsWith('#')).join('\n'), /FSM_TEST_/, 'ci.yml sets a variable of a server');
  const calls = callsOf(['ci-check']);
  const images = calls.indexOf('persist-images');
  assert.ok(images >= 0, `the recipe of the check job runs no make persist-images: ${calls.join(' ')}`);
  assert.ok(calls.indexOf('install') < images && images < calls.indexOf('ci-suite'), `make persist-images does not run after make install and before the suite: ${calls.join(' ')}`);
  const targets = suiteOf('ci-suite');
  // Every target that reads a DSN, and the test of the script of the servers, run in that step.
  const makefile = read('Makefile');
  const reading = [...makefile.matchAll(/^([a-z][a-z0-9-]*):.*\n\t@\$\(call require_dsn,/gm)].map(match => text(match[1], 'a target that requires a DSN'));
  assert.ok(reading.length >= 14, `the Makefile holds ${String(reading.length)} targets that require a DSN`);
  for (const target of [...reading, 'bay-test', 'persist-servers-test']) assert.ok(targets.includes(target), `the suite step does not run ${target}`);
  const check = suiteOf('check');
  for (const target of [...reading, 'bay-test', 'persist-servers-test']) assert.ok(check.includes(target), `make check does not run ${target}`);
});

// bay (plan C-6, S-475-5): the action runner-setup installs the pinned release before the run step of the job, because a recipe
// changes no setting of the machine, and gives the job BAY="sudo -n bay" through GITHUB_ENV, because on the runner the state of
// bay belongs to root and the user of the job has sudo without a password; the Makefile exports BAY to every call of the recipe.
test('the check job installs the pinned bay through runner-setup and starts bay through sudo -n in each of its calls of bay', () => {
  const calls = callsOf(['ci-check']);
  const [install, images, suite] = ['install', 'persist-images', 'ci-suite'].map(call => calls.indexOf(call));
  assert.ok(install !== undefined && images !== undefined && suite !== undefined && install >= 0 && install < images && images < suite, `make ci-check does not run make install, make persist-images and the suite in that order: ${calls.join(' ')}`);
  assert.ok(!calls.includes('bay-install') && !calls.includes('gui-browser-libraries'), `make ci-check changes a setting of the machine: ${calls.join(' ')}`);
  const steps = stepsOf(CHECK_JOB);
  const setup = steps.findIndex(entry => entry.includes('uses: ./.github/actions/runner-setup'));
  const run = steps.findIndex(entry => /\n {8}run: /.test(entry));
  assert.ok(setup >= 0 && setup < run, 'the check job does not use runner-setup before its run step');
  assert.match(text(steps[setup], 'the runner-setup step'), /\n {10}browser-libraries: 'true'\n {10}bay: 'true'(?:\n|$)/, 'the check job does not set up the libraries of Chromium and bay');
  assert.match(read('Makefile'), /^export BAY$/m, 'the Makefile does not export BAY to the calls of a recipe');
  const recipe = make(['-n', 'runner-setup-bay'], { GITHUB_ENV: '/dev/null' });
  assert.equal(recipe.code, 0, recipe.output);
  assert.match(recipe.output, /^\S+\/node scripts\/bay\.mts install$/m);
  assert.match(recipe.output, /^echo 'BAY=sudo -n bay' >> "\$GITHUB_ENV"$/m);
  const action = read('.github/actions/runner-setup/action.yml');
  for (const target of ['install-llvm', 'gui-browser-libraries', 'runner-setup-bay']) assert.match(action, new RegExp(`\\n {6}run: make ${target}$`, 'm'), `runner-setup does not run make ${target}`);
});

// No recipe of a job runs sudo (S-484): the dry run of each recipe, with the calls of make that it prints, holds no sudo.
test('no recipe of a job runs sudo', () => {
  for (const goals of [['ci-shared'], ['ci-runtime', 'RUNTIME=php'], ['ci-check'], ['ci-assets-platform'], ['ci-assets-npm'], ['ci-pages'], ['ci-release-tag', 'RUN=1'], ['ci-release-publish']]) {
    const dry = make(['-n', ...goals], { GITHUB_ENV: '/dev/null' });
    assert.doesNotMatch(dry.output, /\bsudo\b/, `make ${goals.join(' ')} runs sudo:\n${dry.output}`);
  }
});

// A dry run prints the recipe of the servers and starts nothing: a recipe that ran would write a line that starts with
// persist-servers:, the version of bay or the failure of a PATH without bay.
test('make persist-servers runs TARGETS through make ci-targets under scripts/persist-servers.mts, and make check and make ci-suite run through it', t => {
  const { directory } = standIns(t, 'DryRun');
  const dry = (goal: string, env: Record<string, string> = {}) => make(['-n', goal], { PATH: `${directory}:${process.env.PATH ?? ''}`, ...env });
  const servers = dry('persist-servers', { TARGETS: 'db-test-postgres db-test-mysql' });
  assert.equal(servers.code, 0, servers.output);
  assert.match(servers.output, /^\S+\/node scripts\/persist-servers\.mts run -- \S*make ci-targets TARGETS="db-test-postgres db-test-mysql"$/m);
  assert.doesNotMatch(servers.output, /persist-servers:/, 'the dry run ran the recipe of the servers');
  const images = dry('persist-images');
  assert.equal(images.code, 0, images.output);
  assert.match(images.output, /^\S+\/node scripts\/persist-servers\.mts pull$/m);
  for (const goal of ['check', 'ci-suite']) {
    const suite = dry(goal);
    assert.equal(suite.code, 0, suite.output);
    assert.match(suite.output, /^\S+\/node scripts\/persist-servers\.mts run -- \S*make ci-targets TARGETS="[^"]*\bdb-test-postgres\b[^"]*"$/m, `${goal} does not run its targets with the servers`);
    assert.doesNotMatch(suite.output, /persist-servers:/, `the dry run of ${goal} ran the recipe of the servers`);
  }
});

// Each job that runs targets uploads its report (plan C-10): the report of make ci-targets, also after a failed target.
test('the check job uploads the report of make ci-targets as its last step, also after a failure', () => {
  const steps = stepsOf(CHECK_JOB);
  const upload = text(steps.at(-1), 'the last step of the check job');
  assert.match(upload, /\n {8}uses: actions\/upload-artifact@[0-9a-f]{40}/, `the last step of the check job uploads no artifact:\n${upload}`);
  assert.match(upload, /\n {8}if: \$\{\{ !cancelled\(\) \}\}\n/);
  assert.match(upload, /\n {10}name: fsm-report-check\n/);
  const report = /^CI_REPORT \?= (\S+)$/m.exec(read('Makefile'))?.[1];
  assert.ok(report !== undefined, 'the Makefile sets no CI_REPORT');
  assert.ok(upload.includes(`\n          path: ${report}/\n`), `the step does not upload ${report}/:\n${upload}`);
});

/** The result of `make <goals>` in the repository with the variables `env` added and no inherited make flags; `-n` in `goals` prints the recipe and runs nothing. */
function make(goals: string[], env: Record<string, string> = {}): { code: number | null; output: string } {
  const clean = cleanEnv();
  // The variables that the recipes below read are those of the case alone.
  for (const name of ['RESULTS', 'FAIL_SKIPPED', 'TAG', 'RUNNER_TEMP', 'TARGETS', 'TOOLS', 'RUNTIME', 'GROUP', 'RELEASE', 'BAY', 'VITEPRESS_BASE', 'GITHUB_OUTPUT']) Reflect.deleteProperty(clean, name);
  const result = spawnSync('make', ['--no-print-directory', ...goals], { cwd: ROOT, encoding: 'utf8', env: { ...clean, ...env } });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

// The targets that the steps of the workflows run in place of a shell command (S-472): the last job of ci and of the pipeline,
// the checkout of the release tag, the bootstrap of the action and the system libraries of Chromium.
test('make ci-passed passes only when every job of RESULTS succeeded', () => {
  const results = (shared: string, runtime: string): Record<string, string> => ({ RESULTS: JSON.stringify({ shared: { result: shared, outputs: {} }, runtime: { result: runtime, outputs: {} } }) });
  const good = make(['ci-passed', 'FAIL_SKIPPED=1'], results('success', 'success'));
  assert.equal(good.code, 0, good.output);
  for (const [shared, runtime] of [['success', 'failure'], ['cancelled', 'success'], ['failure', 'skipped'], ['success', 'skipped']] as const) {
    const bad = make(['ci-passed', 'FAIL_SKIPPED=1'], results(shared, runtime));
    assert.notEqual(bad.code, 0, `ci-passed passed with shared ${shared} and runtime ${runtime}:\n${bad.output}`);
  }
  const unset = make(['ci-passed', 'FAIL_SKIPPED=1']);
  assert.notEqual(unset.code, 0, `ci-passed passed with no RESULTS:\n${unset.output}`);
  assert.match(unset.output, /RESULTS is not set/);
});

test('make release-checkout and make release-undraft read TAG from the environment and fail without it', () => {
  for (const target of ['release-checkout', 'release-undraft']) {
    const missing = make([target]);
    assert.notEqual(missing.code, 0, `${target} passed with no TAG`);
    assert.match(missing.output, new RegExp(`${target}: TAG is required`));
  }
  const checkout = make(['-n', 'release-checkout'], { TAG: 'v0.0.1' });
  assert.equal(checkout.code, 0, checkout.output);
  assert.match(checkout.output, /^git checkout --quiet "\$TAG"$/m);
});

test('make bootstrap installs the lock with the npm of devEngines outside the checkout, and gui-browser-libraries runs the Playwright of packages/gui', () => {
  const bootstrap = make(['-n', 'bootstrap']);
  assert.equal(bootstrap.code, 0, bootstrap.output);
  assert.match(bootstrap.output, /devEngines\.packageManager\.version/);
  assert.match(bootstrap.output, /cd "\$\{RUNNER_TEMP:-\$\{TMPDIR:-\/tmp\}\}" && .* exec --yes --package="npm@\$version" -- npm --prefix "\$root" ci --ignore-scripts$/m);
  const libraries = make(['-n', 'gui-browser-libraries']);
  assert.equal(libraries.code, 0, libraries.output);
  assert.match(libraries.output, /^cd packages\/gui && sudo env PATH="\$PATH" +node_modules\/\.bin\/playwright install-deps chromium$/m);
});

// The jobs of the pipeline hold their content in recipes (S-484): the run step of a job is make ci-<job> with the value of its
// matrix on the command line, a variable of the command line reaches every call of the recipe, and the recipes ci-shared and
// ci-runtime read the tools and the targets of their job from the plan from which the plan job writes the outputs of GitHub.
test('the recipes of the pipeline install the tools of the plan, set up and run their gates inside the context, on the runner of config/ci.json', () => {
  const targets = make(['-n', 'ci-targets', 'TARGETS=kit-gates-runtime-php docs-check']);
  assert.equal(targets.code, 0, targets.output);
  assert.match(targets.output, /ci-targets\.m[jt]s -k \S+ kit-gates-runtime-php docs-check$/m);
  const tools = make(['-n', 'install-tools', 'TOOLS=php composer']);
  assert.equal(tools.code, 0, tools.output);
  assert.match(tools.output, /install-tools\.m[jt]s --no-self-update php composer$/m);
  for (const verb of ['setup', 'context-prepare', 'context-cleanup']) {
    const setup = make(['-n', `kit-ci-${verb}`, 'GROUP=runtime', 'RUNTIME=php-ext']);
    assert.equal(setup.code, 0, setup.output);
    assert.match(setup.output, new RegExp(`ci-setup\\.m[jt]s --${verb} runtime php-ext$`, 'm'));
  }
  const pipeline = jobsOf(read('.github/workflows/ci-pipeline.yml'));
  assert.match(job(pipeline, 'plan'), /\n {8}run: make kit-ci-plan$/m, 'the plan job does not run make kit-ci-plan');
  assert.match(job(pipeline, 'shared'), /\n {8}run: make ci-shared$/m, 'the shared job does not run make ci-shared');
  assert.match(job(pipeline, 'runtime'), /\n {8}run: make ci-runtime RUNTIME=\$\{\{ matrix\.runtime \}\}$/m, 'the runtime job does not run make ci-runtime with the runtime of its matrix');
  assert.match(job(pipeline, 'runtime'), /\n {8}include: \$\{\{ fromJSON\(needs\.plan\.outputs\.runtimes\) \}\}$/m, 'the matrix of the runtime job does not fan out from the plan');

  const runtime = make(['-n', 'ci-runtime', 'RUNTIME=php']);
  assert.equal(runtime.code, 0, runtime.output);
  assert.deepEqual(callsOf(['ci-runtime', 'RUNTIME=php']), ['install-tools', 'kit-ci-setup', 'kit-install-symbols', 'ci-context-targets']);
  assert.deepEqual(callsOf(['ci-runtime', 'RUNTIME=go']), ['install-tools', 'kit-ci-setup', 'ci-context-targets']);
  assert.match(runtime.output, /scripts\/ci-plan\.mts \S+\/ci-setup\.m[jt]s tools runtime php\)" && \{ test -z "\$tools" \|\| \S*make --no-print-directory install-tools TOOLS="\$tools"; \}$/m);
  assert.match(runtime.output, /scripts\/ci-plan\.mts \S+\/ci-setup\.m[jt]s targets runtime php\)" && \S*make --no-print-directory ci-context-targets GROUP=runtime RUNTIME=php TARGETS="kit-gates-runtime-php \$targets"$/m);
  const unset = make(['ci-runtime']);
  assert.equal(unset.code, 2, unset.output);
  assert.match(unset.output, /ci-runtime: RUNTIME is required/);
  const shared = make(['-n', 'ci-shared']);
  assert.equal(shared.code, 0, shared.output);
  assert.deepEqual(callsOf(['ci-shared']), ['install-tools', 'kit-ci-setup', 'ci-context-targets']);
  assert.match(shared.output, /\S*make --no-print-directory ci-context-targets GROUP=shared TARGETS="kit-gates-static \$targets"$/m);
  // The cleanup of the context runs after the prepare has run, also after a failed prepare or target.
  assert.deepEqual(callsOf(['ci-context-targets', 'GROUP=runtime', 'RUNTIME=php', 'TARGETS=lint-php']), ['kit-ci-context-prepare', 'ci-targets', 'kit-ci-context-cleanup']);

  // scripts/ci-plan.mts prints the lists of the plan that kit computes from config/ci.json.
  const ciSetup = /scripts\/ci-plan\.mts (\S+\/ci-setup\.m[jt]s) /.exec(shared.output)?.[1];
  assert.ok(ciSetup !== undefined, `the recipe of ci-shared does not name the ci-setup of kit:\n${shared.output}`);
  const plan = (...args: string[]) => spawnSync(process.execPath, ['scripts/ci-plan.mts', ciSetup, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...cleanEnv(), GITHUB_OUTPUT: '' } });
  const ciConfig: unknown = JSON.parse(read('config/ci.json'));
  const configured = (key: string): unknown => field(field(ciConfig, 'tools', 'config/ci.json'), key, 'tools of config/ci.json');
  const sharedTools = plan('tools', 'shared');
  assert.equal(sharedTools.status, 0, sharedTools.stderr);
  for (const tool of words(configured('shared'))) assert.ok(sharedTools.stdout.trim().split(' ').includes(tool), `the tools of the shared job hold no ${tool}: ${sharedTools.stdout}`);
  const goTools = plan('tools', 'runtime', 'go');
  assert.equal(goTools.status, 0, goTools.stderr);
  for (const tool of words(configured('go'))) assert.ok(goTools.stdout.trim().split(' ').includes(tool), `the tools of the runtime go hold no ${tool}: ${goTools.stdout}`);
  const goTargets = plan('targets', 'runtime', 'go');
  assert.equal(goTargets.status, 0, goTargets.stderr);
  assert.equal(goTargets.stdout, '\n', 'config/ci.json declares no targets of the runtime go');
  const missing = plan('tools', 'runtime', 'none');
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /the plan holds no runtime none; it holds go, php, php-ext, python, rust, ts/);
  const usage = plan('tools', 'runtime');
  assert.equal(usage.status, 2, usage.stderr);
  assert.match(usage.stderr, /^usage: scripts\/ci-plan\.mts/);

  for (const file of ['.github/workflows/ci.yml', '.github/workflows/ci-pipeline.yml', '.github/workflows/release.yml', '.github/workflows/pages.yml']) {
    for (const runner of read(file).matchAll(/^ +runs-on: (.*)$/gm)) assert.equal(runner[1], field(JSON.parse(read('config/ci.json')), 'runner', 'config/ci.json'), `${file} names another runner than config/ci.json`);
  }
});

// The jobs of assets.yml and pages.yml hold their content in recipes (S-484): the input release of the caller reaches the recipe
// as RELEASE, which runs the release check of binding before the assets, and the recipe of the site sets its base.
test('the jobs of assets.yml and pages.yml run their recipes, and RELEASE=true adds the release check of binding', () => {
  const assets = jobsOf(read('.github/workflows/assets.yml'));
  for (const name of ['platform', 'npm']) assert.match(job(assets, name), new RegExp(`\\n {8}run: make ci-assets-${name} RELEASE=\\$\\{\\{ inputs\\.release \\}\\}$`, 'm'), `the job ${name} of assets.yml does not run make ci-assets-${name} with the input release`);
  assert.match(job(assets, 'platform'), /uses: \.\/\.github\/actions\/runner-setup\n {8}with:\n {10}llvm: 'true'\n/, 'the job platform does not install LLVM through runner-setup');
  assert.match(job(jobsOf(PAGES), 'pages'), /\n {8}run: make ci-pages$/m, 'the job pages does not run make ci-pages');
  assert.deepEqual(callsOf(['ci-assets-platform']), ['install-tools', 'llvm-check', '-k']);
  assert.deepEqual(callsOf(['ci-assets-platform', 'RELEASE=true']), ['install-tools', 'llvm-check', 'release-binding-check', '-k']);
  const platform = make(['-n', 'ci-assets-platform', 'RELEASE=false']);
  assert.equal(platform.code, 0, platform.output);
  assert.match(platform.output, /^\S*make --no-print-directory install-tools TOOLS="rust uv python"$/m);
  assert.match(platform.output, /^\S*make --no-print-directory -k release-go-static release-wheel release-php-ext release-npm-platform PHP=php$/m);
  assert.deepEqual(callsOf(['ci-assets-npm']), ['install-tools', 'install-wasm-bindgen', 'release-npm']);
  assert.deepEqual(callsOf(['ci-assets-npm', 'RELEASE=true']), ['install-tools', 'install-wasm-bindgen', 'release-binding-check', 'release-npm']);
  for (const goal of ['ci-assets-platform', 'ci-assets-npm']) {
    const wrong = make([goal, 'RELEASE=yes']);
    assert.equal(wrong.code, 2, wrong.output);
    assert.match(wrong.output, new RegExp(`${goal}: RELEASE is true, false or empty, not yes`));
  }
  assert.deepEqual(callsOf(['ci-pages']), ['docs-build']);
  const makefile = read('Makefile');
  assert.match(makefile, /^ci-pages: export VITEPRESS_BASE := \/fsm\/$/m, 'the recipe of the site does not set the base /fsm/');
  assert.match(makefile, /^ci-check ci-assets-platform ci-assets-npm ci-release-publish: export RUSTUP_AUTO_INSTALL := 0$/m, 'the recipes that run cargo do not set RUSTUP_AUTO_INSTALL to 0');
});

// The jobs of release.yml hold their content in recipes (S-484): the job tag runs make ci-release-tag with the input run, and
// the job publish runs make ci-release-publish, whose calls are the targets of the release in their order.
test('the jobs of release.yml run make ci-release-tag and make ci-release-publish', () => {
  const release = jobsOf(read('.github/workflows/release.yml'));
  assert.match(job(release, 'tag'), /\n {8}run: make ci-release-tag RUN=\$\{\{ inputs\.run \}\}$/m, 'the job tag does not run make ci-release-tag RUN=${{ inputs.run }}');
  assert.match(job(release, 'publish'), /\n {8}run: make ci-release-publish$/m, 'the job publish does not run make ci-release-publish');
  assert.deepEqual(callsOf(['ci-release-tag', 'RUN=7'], { GITHUB_ENV: '/dev/null' }), ['release-tag', 'release-tag-output']);
  assert.match(make(['-n', 'ci-release-tag', 'RUN=7', 'GITHUB_EVENT_NAME=workflow_run'], { GITHUB_ENV: '/dev/null' }).output, /release-tag AUTO=1$/m, 'a workflow_run does not release with AUTO=1');
  assert.deepEqual(callsOf(['ci-release-publish', 'TAG=v0.0.1']), ['release-zip', 'release-prepare', 'release-tools', 'release-assets', 'install-tools', 'release-go-module', 'release-publish', 'release-platform-assets', 'release-undraft']);
});
