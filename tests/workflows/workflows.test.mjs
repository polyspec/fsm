// Tests of the CI and Pages workflows (docs/plans/fsm-v1.md, C-10 and Verification; docs/plans/execution-checklist.md, S-21).
// The workflows are read as text, so the test needs no YAML parser and no network. Each version is compared with the file
// that declares it, and the services and env of the CI job with the block that plan C-6 holds, so the plan and the workflow
// cannot drift apart. The action pins are the commits that the template repository verified for the same versions.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(ROOT, file), 'utf8');
// The workflows that kit.json vendors belong to kit: make kit-check keeps them byte for byte, so the rules of fsm's own workflows
// below do not read them.
const VENDORED = Object.keys(JSON.parse(read('kit.json')).vendoredFiles);
const WORKFLOWS = readdirSync(path.join(ROOT, '.github/workflows')).filter(name => name.endsWith('.yml')).sort().map(name => `.github/workflows/${name}`)
  .filter(file => !VENDORED.includes(file));
const CI = read('.github/workflows/ci.yml');
const PAGES = read('.github/workflows/pages.yml');
const PLAN = read('docs/plans/fsm-v1.md');
const TOOLCHAIN = JSON.parse(read('config/toolchain.json'));

// The commits of the template repository for the actions that these workflows use (its action-pins test, T22.4-8).
const VERIFIED = [
  { action: 'actions/checkout', version: 'v6.1.0', commit: 'd23441a48e516b6c34aea4fa41551a30e30af803' },
  { action: 'actions/configure-pages', version: 'v6.0.0', commit: '45bfe0192ca1faeb007ade9deae92b16b8254a0d' },
  { action: 'actions/deploy-pages', version: 'v5.0.1', commit: '368f82528645a54fb793d4d04e342629a3f51346' },
  { action: 'actions/setup-go', version: 'v6.5.0', commit: '924ae3a1cded613372ab5595356fb5720e22ba16' },
  { action: 'actions/setup-node', version: 'v6.5.0', commit: '249970729cb0ef3589644e2896645e5dc5ba9c38' },
  { action: 'actions/upload-artifact', version: 'v7.0.1', commit: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' },
  { action: 'actions/upload-pages-artifact', version: 'v5.0.0', commit: 'fc324d3547104276b827a68afc52ff2a11cc49c9' },
  { action: 'shivammathur/setup-php', version: '2.37.2', commit: 'f3e473d116dcccaddc5834248c87452386958240' },
];

// The jobs of a workflow: the text of each job under `jobs:`, from its name line to the next job.
function jobsOf(text) {
  const body = text.split(/\njobs:\n/)[1];
  assert.ok(body, 'the workflow has no jobs: block');
  const jobs = new Map();
  let name = null;
  for (const line of body.split('\n')) {
    const head = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (head) {
      name = head[1];
      jobs.set(name, []);
    } else if (name) {
      jobs.get(name).push(line);
    }
  }
  return new Map([...jobs].map(([job, lines]) => [job, lines.join('\n')]));
}

// The steps of a job: the text of each `- ` item of `steps:`.
function stepsOf(jobText) {
  const [, steps = ''] = jobText.split(/\n {4}steps:\n/);
  return steps.split(/\n(?= {6}- )/).filter(step => step.trim());
}

// The targets of every make command in a job, in order. Comment lines are not commands.
function makeTargets(jobText) {
  return jobText
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .flatMap(line => [...line.matchAll(/\bmake\s+([^\s"'$]+)/g)].map(match => match[1]));
}

const ci = jobsOf(CI);
const pages = jobsOf(PAGES);
const CHECK_JOB = ci.get('check');

// ubuntu-26.04: orm's PHP client requires SQLite 3.46, and the PHP of ubuntu-24.04 links its system SQLite 3.45.1 (S-21-1).
test('the CI workflow has one job, check, on ubuntu-26.04', () => {
  assert.deepEqual([...ci.keys()], ['check']);
  assert.match(CHECK_JOB, /^ {4}runs-on: ubuntu-26\.04$/m);
  assert.match(pages.get('pages'), /^ {4}runs-on: ubuntu-26\.04$/m);
});

test('the rules read the own workflows of fsm, ci.yml and pages.yml, and not the release workflow that kit vendors', () => {
  assert.deepEqual(VENDORED, ['.github/workflows/release.yml']);
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
  const found = [];
  for (const file of WORKFLOWS) {
    read(file).split('\n').forEach((line, index) => {
      const match = /uses:\s+([\w.-]+\/[\w.-]+)@(\S+)(?:\s+#\s*(\S+))?/.exec(line);
      if (match) found.push({ where: `${file}:${index + 1}`, action: match[1], commit: match[2], version: match[3] });
    });
  }
  assert.ok(found.length > 0, 'no uses: line was found; the pin check verified nothing');
  const failures = [];
  for (const pin of found) {
    if (!/^[0-9a-f]{40}$/.test(pin.commit)) failures.push(`${pin.where}: ${pin.action} is not pinned to a 40-character commit`);
    else if (!pin.version) failures.push(`${pin.where}: ${pin.action} has no version comment`);
    else if (!VERIFIED.some(entry => entry.action === pin.action && entry.commit === pin.commit && entry.version === pin.version)) {
      failures.push(`${pin.where}: ${pin.action}@${pin.commit} # ${pin.version} is not a verified pin`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the check job runs make install, then the playwright dependencies, then make check, and no other make target', () => {
  assert.deepEqual(makeTargets(CHECK_JOB), ['install', 'check']);
  const install = CHECK_JOB.indexOf('make install');
  const deps = CHECK_JOB.indexOf('install-deps chromium');
  const check = CHECK_JOB.indexOf('make check');
  assert.ok(install > 0 && deps > install && check > deps, 'the order must be make install, install-deps chromium, make check');
  const depsStep = stepsOf(CHECK_JOB).find(step => step.includes('install-deps chromium'));
  assert.match(depsStep, /sudo env PATH="\$PATH" npx playwright install-deps chromium/);
  assert.match(depsStep, /working-directory: packages\/fsm-gui/);
});

test('the pages job runs make docs-build only', () => {
  assert.deepEqual(makeTargets(pages.get('pages')), ['docs-build']);
});

test('the services and env of the check job are the lines of plan C-6, copied exactly', () => {
  const section = PLAN.split('CI services for S-21');
  assert.equal(section.length, 2, 'plan C-6 must hold one CI services block');
  const block = /```yaml\n([\s\S]*?)```/.exec(section[1])?.[1];
  assert.ok(block, 'plan C-6 has no yaml block after CI services for S-21');
  assert.ok(CHECK_JOB.includes(block), `the check job does not hold the block of plan C-6:\n${block}`);
});

test('the node, go, php and rust versions come from the files that declare them', () => {
  assert.match(CHECK_JOB, /\n {10}node-version-file: \.node-version\n/);
  assert.doesNotMatch(CHECK_JOB, /node-version: /);
  assert.match(read('.node-version'), /^\d+\.\d+\.\d+\n$/);

  const goMod = TOOLCHAIN.go.mod;
  assert.equal(goMod, 'packages/fsm-go/go.mod');
  assert.match(CHECK_JOB, new RegExp(`\\n {10}go-version-file: ${goMod.replace(/[.]/g, '\\.')}\\n`));
  assert.match(read(goMod), /^go 1\.27$/m);

  assert.equal(TOOLCHAIN.php.length, 1, 'config/toolchain.json must declare one PHP minor for the check job');
  assert.match(CHECK_JOB, new RegExp(`\\n {10}php-version: '${TOOLCHAIN.php[0].replace(/\./g, '\\.')}'\\n`));
  assert.match(CHECK_JOB, /\n {10}extensions: .*pdo_pgsql.*pdo_mysql|\n {10}extensions: .*pdo_mysql.*pdo_pgsql/);

  const rustChannel = /^channel = "(\d+\.\d+\.\d+)"$/m.exec(read('rust-toolchain.toml'))?.[1];
  assert.ok(rustChannel, 'rust-toolchain.toml must name an exact channel');
  const rustStep = stepsOf(CHECK_JOB).find(step => step.includes('rustup toolchain install'));
  assert.ok(rustStep, 'the check job installs no rust toolchain with rustup');
  assert.match(rustStep, /rust-toolchain\.toml/);
  assert.match(rustStep, /--profile minimal/);
});

test('uv is installed at the version that plan C-10 pins', () => {
  const pin = /`uv==(\d+\.\d+\.\d+)`/.exec(PLAN.split('### C-10')[1] ?? '')?.[1];
  assert.ok(pin, 'plan C-10 must pin uv as `uv==<version>`');
  const install = CHECK_JOB.match(/pipx install uv==(\S+)/)?.[1];
  assert.equal(install, pin);
});

test('the check job uploads the results of make check and the full-run record under !cancelled()', () => {
  const upload = stepsOf(CHECK_JOB).find(step => step.includes('upload-artifact'));
  assert.ok(upload, 'the check job has no upload-artifact step');
  assert.match(upload, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(upload, /var\/full-run\.json/);
  assert.match(upload, /\.results\//);
});

test('the pages workflow builds the site with VITEPRESS_BASE=/fsm/ and deploys docs/.vitepress/dist', () => {
  const build = stepsOf(pages.get('pages')).find(step => step.includes('make docs-build'));
  assert.ok(build, 'the pages job has no make docs-build step');
  assert.match(build, /VITEPRESS_BASE: \/fsm\//);
  assert.match(pages.get('pages'), /\n {6}pages: write\n/);
  assert.match(pages.get('pages'), /\n {6}id-token: write\n/);
  const upload = stepsOf(pages.get('pages')).find(step => step.includes('upload-pages-artifact'));
  assert.match(upload, /path: docs\/\.vitepress\/dist/);
  assert.ok(stepsOf(pages.get('pages')).some(step => step.includes('uses: actions/deploy-pages@')), 'the pages job has no deploy-pages step');
});

test('every action of the workflows is one of the verified pins, and the pages job uses the Pages actions', () => {
  assert.match(PAGES, /uses: actions\/configure-pages@/);
  assert.match(PAGES, /uses: actions\/upload-pages-artifact@/);
  assert.match(PAGES, /uses: actions\/deploy-pages@/);
});
