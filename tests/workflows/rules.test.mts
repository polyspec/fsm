// The rules of the GitHub workflows of this repository (docs/plans/fsm-v1/checklist.md, S-472), checked on the tracked
// files of .github and on the Makefile:
//
//   - every job runs on ubuntu-26.04-arm, except the job platform of assets.yml, which runs on the runner of each platform of the
//     release, ubuntu-26.04, ubuntu-26.04-arm or macos-15, because the asset of a platform is linked and loaded only on that
//     platform: no tool of the release compiles for another platform (plan C-11, S-470-9);
//   - no job holds a block services: a server of a test runs from an image pinned by its digest, which a make target
//     starts in the container program of the platform;
//   - every action is a local action of .github/actions or is pinned by its full commit, and a comment of the file names
//     its release, `# <owner>/<repository> <release>`;
//   - no job and no step sets timeout-minutes;
//   - every run step is one make target that the Makefile defines, with arguments NAME=value or one expression alone,
//     so that the settings and the checks of the Makefile apply to every command of CI;
//   - the workflow ci starts on a push of main and on workflow_dispatch alone;
//   - the last job of the workflow ci is ci-passed, which runs after every other job, also after a failed one
//     (`if: ${{ always() }}`), needs each of them and runs `make ci-passed FAIL_SKIPPED=1` with RESULTS, the JSON of
//     its needs, so that it passes only when every other job succeeded.
//
// The test reads the files as text, line by line: the workflows hold one key on a line, and a run step whose command
// continues on a later line is a finding.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = 'ubuntu-26.04-arm';
const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';
const LAST = 'ci-passed';
const ASSETS = '.github/workflows/assets.yml';
// The runner of each platform of the release, on which the job platform of assets.yml builds the assets of that platform
// (binding GN-19a with the runners of this repository).
const PLATFORM_RUNNERS: Record<string, string> = { 'linux-x64-gnu': 'ubuntu-26.04', 'linux-arm64-gnu': 'ubuntu-26.04-arm', 'darwin-arm64': 'macos-15' };
const MATRIX_RUNNER = '${{ matrix.runner }}';

// A run step: make, one target, then arguments NAME=value, NAME="words" for a list such as the tools of a job, or
// expressions ${{ ... }}.
const RUN = /^make ([a-z][a-z0-9-]*)((?: (?:[A-Z][A-Z0-9_]*=(?:[A-Za-z0-9_.-]+|"[A-Za-z0-9_. -]+")|\$\{\{[^}]*\}\}))*)$/;
const PINNED = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@[0-9a-f]{40}$/;

/** The targets that the text of a Makefile defines with a rule. */
function makeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split('\n')) {
    const names = /^([a-z][A-Za-z0-9_.-]*(?: +[a-z][A-Za-z0-9_.-]*)*) *:(?!=)/.exec(line)?.[1];
    if (names !== undefined) for (const name of names.split(/ +/)) targets.add(name);
  }
  return targets;
}

/** The value of the key `key` of a line, `key: value` or `- key: value`, without its quotes; undefined for another line. */
function valueOf(line: string, key: string): string | undefined {
  const found = new RegExp(`^ *(?:- )?${key}: *(.*)$`).exec(line)?.[1];
  return found?.trim();
}

/**
 * The findings of the workflow or action `file` with the text `text`, each `<file>:<line>: <finding>`. `targets` are the
 * targets of the Makefile and `actions` the local actions, `./.github/actions/<name>`.
 */
function findings(file: string, text: string, targets: Set<string>, actions: Set<string>): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  const comments = lines.filter((line) => line.trim().startsWith('#'));
  let runners = 0;
  lines.forEach((line, index) => {
    if (line.trim().startsWith('#')) return;
    const at = `${file}:${String(index + 1)}`;
    if (/^ *(?:- )?timeout-minutes:/.test(line)) found.push(`${at}: sets timeout-minutes`);
    if (/^ *services:/.test(line)) found.push(`${at}: holds a block services`);
    const runner = valueOf(line, 'runs-on');
    if (runner !== undefined) {
      runners += 1;
      // The runner of the matrix is judged by platformFindings, in the job platform of assets.yml alone.
      if (runner !== RUNNER && !(file === ASSETS && runner === MATRIX_RUNNER)) found.push(`${at}: runs on ${runner}, not on ${RUNNER}`);
    }
    // The release of an action is named by a comment line, `# <owner>/<repository> <release>`, or by the comment that
    // ends the line of its pin, `# <release>`.
    const [uses, release] = valueOf(line, 'uses')?.split(/ +# +/) ?? [];
    if (uses !== undefined) {
      if (uses.startsWith('./')) {
        if (!actions.has(uses)) found.push(`${at}: uses ${uses}, which is no tracked action`);
      } else {
        const name = PINNED.exec(uses)?.[1];
        if (name === undefined) found.push(`${at}: uses ${uses}, which is not pinned by a full commit`);
        else if (!/^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(release ?? '') && !comments.some((comment) => new RegExp(`# ${name.replaceAll('.', '\\.')} v?[0-9]+\\.[0-9]+\\.[0-9]+\\b`).test(comment)))
          found.push(`${at}: no comment names the release of ${name}`);
      }
    }
    const run = valueOf(line, 'run');
    const next = lines.slice(index + 1).find((later) => later.trim() !== '' && !later.trim().startsWith('#'));
    const deeper = next !== undefined && next.search(/\S/) > line.indexOf('run:');
    // A key `run:` with no value whose deeper lines are keys is a mapping of that name, such as the input `run` of a
    // dispatch, and no run step.
    if (run !== undefined && !(run === '' && deeper && /^ *[A-Za-z_-]+:(?: |$)/.test(next))) {
      const target = RUN.exec(run)?.[1];
      if (target === undefined) found.push(`${at}: the run step is not one make target: ${run}`);
      else if (!targets.has(target)) found.push(`${at}: the Makefile defines no target ${target}`);
      if (deeper) found.push(`${at}: the run step continues on a later line`);
    }
  });
  if (file.includes('/workflows/') && runners === 0) found.push(`${file}: names no runner`);
  return found;
}

/** The findings of the triggers of the workflow ci: the keys of its block `on:` are push, of main alone, and workflow_dispatch. */
function triggerFindings(file: string, text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('on:');
  if (start < 0) return [`${file}: has no block on:`];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    if (line.trim() !== '' && !line.trim().startsWith('#')) block.push(line);
  }
  const indent = Math.min(...block.map((line) => line.search(/\S/)));
  const keys = block.filter((line) => line.search(/\S/) === indent).map((line) => line.trim().replace(/:.*$/, '')).sort();
  const found: string[] = [];
  if (keys.join(' ') !== 'push workflow_dispatch') found.push(`${file}: starts on ${keys.join(', ') || 'nothing'}, not on push and workflow_dispatch alone`);
  if (block.filter((line) => /^ *branches:/.test(line)).map((line) => line.trim()).join(' ') !== 'branches: [main]') found.push(`${file}: the push is not of main alone`);
  return found;
}

/** The jobs of a workflow in their order: the keys of its block `jobs:`, each with the lines of its mapping. */
function jobsOf(text: string): Map<string, string[]> {
  const lines = text.split('\n');
  const jobs = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const name = /^ {2}([A-Za-z0-9_-]+): *$/.exec(line)?.[1];
    if (name !== undefined) {
      current = [];
      jobs.set(name, current);
    } else if (current !== undefined && !line.trim().startsWith('#')) current.push(line);
  }
  return jobs;
}

/**
 * The findings of the last job of the workflow ci: it is ci-passed, runs after a failed job, needs every other job and
 * judges the results of its needs with `make ci-passed FAIL_SKIPPED=1`.
 */
function lastJobFindings(file: string, text: string): string[] {
  const jobs = jobsOf(text);
  const names = [...jobs.keys()];
  const last = names.at(-1);
  if (last === undefined) return [`${file}: has no job`];
  if (last !== LAST) return [`${file}: the last job is ${last}, not ${LAST}`];
  const lines = jobs.get(LAST) ?? [];
  const value = (key: string): string | undefined => lines.map((line) => valueOf(line, key)).find((found) => found !== undefined);
  const found: string[] = [];
  const condition = value('if');
  if (condition !== '${{ always() }}') found.push(`${file}: the job ${LAST} has the condition ${condition ?? 'none'}, not \${{ always() }}`);
  const needs = /^\[(.*)\]$/.exec(value('needs') ?? '')?.[1]?.split(',').map((name) => name.trim()).filter((name) => name !== '') ?? [];
  const others = names.filter((name) => name !== LAST);
  if ([...needs].sort().join(' ') !== [...others].sort().join(' '))
    found.push(`${file}: the job ${LAST} needs ${needs.join(', ') || 'no job'}, not every other job: ${others.join(', ') || 'none'}`);
  if (value('RESULTS') !== '${{ toJSON(needs) }}') found.push(`${file}: the job ${LAST} does not pass RESULTS, the JSON of its needs`);
  if (!lines.some((line) => valueOf(line, 'run') === `make ${LAST} FAIL_SKIPPED=1`)) found.push(`${file}: the job ${LAST} does not run make ${LAST} FAIL_SKIPPED=1`);
  return found;
}

/**
 * The findings of the runners of assets.yml: the job platform runs on the runner of its matrix, whose entries are the
 * platforms of the release, each with its runner, and no other job runs on a runner of the matrix.
 */
function platformFindings(file: string, text: string): string[] {
  const found: string[] = [];
  const jobs = jobsOf(text);
  for (const [name, lines] of jobs) {
    if (name !== 'platform' && lines.some((line) => valueOf(line, 'runs-on') === MATRIX_RUNNER)) found.push(`${file}: the job ${name} runs on the runner of a matrix`);
  }
  const lines = jobs.get('platform');
  if (lines === undefined) return [...found, `${file}: has no job platform`];
  if (!lines.some((line) => valueOf(line, 'runs-on') === MATRIX_RUNNER)) found.push(`${file}: the job platform does not run on ${MATRIX_RUNNER}`);
  const entries: Record<string, string> = {};
  let platform: string | undefined;
  for (const line of lines) {
    const named = valueOf(line, 'platform');
    if (named !== undefined && line.trim().startsWith('- ')) platform = named;
    const runner = valueOf(line, 'runner');
    if (runner !== undefined && platform !== undefined) {
      entries[platform] = runner;
      platform = undefined;
    }
  }
  const byPlatform = (left: [string, string], right: [string, string]): number => left[0].localeCompare(right[0]);
  if (JSON.stringify(Object.entries(entries).sort(byPlatform)) !== JSON.stringify(Object.entries(PLATFORM_RUNNERS).sort(byPlatform)))
    found.push(`${file}: the job platform runs on ${JSON.stringify(entries)}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`);
  return found;
}

const TARGETS = new Set(['docs-check', 'release-tag', 'ci-passed']);
const ACTIONS = new Set(['./.github/actions/bootstrap']);
const GOOD = `# actions/checkout v7.0.1: the checkout.
name: ci
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  shared:
    runs-on: ubuntu-26.04-arm
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0
      - uses: ./.github/actions/bootstrap
      - name: documents
        run: make docs-check
      - run: make release-tag RUN=1 \${{ github.event_name == 'workflow_run' && 'AUTO=1' || '' }}
`;

test('a workflow that keeps every rule has no finding', () => {
  assert.deepEqual(findings(CI, GOOD, TARGETS, ACTIONS), []);
  assert.deepEqual(triggerFindings(CI, GOOD), []);
  // The input `run` of a dispatch is a mapping, no run step.
  assert.deepEqual(findings(CI, GOOD.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      run:\n        required: true\n'), TARGETS, ACTIONS), []);
});

test('each broken rule of a workflow is a finding', () => {
  const broken = (from: string, to: string): string[] => {
    assert.ok(GOOD.includes(from), `the sample holds no ${from}`);
    return findings(CI, GOOD.replace(from, to), TARGETS, ACTIONS);
  };
  assert.deepEqual(broken('runs-on: ubuntu-26.04-arm', 'runs-on: ubuntu-24.04'), [`${CI}:9: runs on ubuntu-24.04, not on ${RUNNER}`]);
  assert.deepEqual(broken('    runs-on: ubuntu-26.04-arm\n', ''), [`${CI}: names no runner`]);
  assert.deepEqual(broken('    steps:', '    timeout-minutes: 10\n    steps:'), [`${CI}:10: sets timeout-minutes`]);
  assert.deepEqual(broken('    steps:', '    services:\n      postgres:\n        image: postgres:17\n    steps:'), [`${CI}:10: holds a block services`]);
  assert.deepEqual(broken('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@v7'), [`${CI}:11: uses actions/checkout@v7, which is not pinned by a full commit`]);
  assert.deepEqual(broken('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@3d3c42e'), [`${CI}:11: uses actions/checkout@3d3c42e, which is not pinned by a full commit`]);
  assert.deepEqual(broken('# actions/checkout v7.0.1: the checkout.', '# The checkout.'), [`${CI}:11: no comment names the release of actions/checkout`]);
  assert.deepEqual(findings(CI, GOOD.replace('# actions/checkout v7.0.1: the checkout.', '# The checkout.').replace('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'), TARGETS, ACTIONS), []);
  assert.deepEqual(broken('./.github/actions/bootstrap', './.github/actions/other'), [`${CI}:14: uses ./.github/actions/other, which is no tracked action`]);
  assert.deepEqual(broken('run: make docs-check', 'run: node scripts/check.mts'), [`${CI}:16: the run step is not one make target: node scripts/check.mts`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check && make release-tag'), [`${CI}:16: the run step is not one make target: make docs-check && make release-tag`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check release-tag'), [`${CI}:16: the run step is not one make target: make docs-check release-tag`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make test'), [`${CI}:16: the Makefile defines no target test`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check TOOLS="alint php python"'), []);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check TOOLS="a; b"'), [`${CI}:16: the run step is not one make target: make docs-check TOOLS="a; b"`]);
  assert.deepEqual(broken('run: make docs-check', 'run: |\n          make docs-check'), [`${CI}:16: the run step is not one make target: |`, `${CI}:16: the run step continues on a later line`]);
  assert.deepEqual(broken('run: make docs-check', 'run:\n          make docs-check && make release-tag'), [`${CI}:16: the run step is not one make target: `, `${CI}:16: the run step continues on a later line`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check\n          make release-tag'), [`${CI}:16: the run step continues on a later line`]);
});

test('each trigger of the workflow ci other than a push of main and workflow_dispatch is a finding', () => {
  assert.deepEqual(triggerFindings(CI, GOOD.replace('on:\n', 'on:\n  pull_request:\n')), [`${CI}: starts on pull_request, push, workflow_dispatch, not on push and workflow_dispatch alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('  workflow_dispatch:\n', '')), [`${CI}: starts on push, not on push and workflow_dispatch alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('branches: [main]', 'branches: [main, next]')), [`${CI}: the push is not of main alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('    branches: [main]\n', '')), [`${CI}: the push is not of main alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('on:\n', 'on: [push]\n')), [`${CI}: has no block on:`]);
});

const LAST_JOB = `  rust:
    runs-on: ubuntu-26.04-arm
    steps:
      - run: make docs-check
  ci-passed:
    if: \${{ always() }}
    needs: [shared, rust]
    runs-on: ubuntu-26.04-arm
    steps:
      - uses: ./.github/actions/bootstrap
      - name: every job passed
        env:
          RESULTS: \${{ toJSON(needs) }}
        run: make ci-passed FAIL_SKIPPED=1
`;

test('the last job of the workflow ci is ci-passed, which needs every other job and judges their results', () => {
  const good = GOOD + LAST_JOB;
  assert.deepEqual(findings(CI, good, TARGETS, ACTIONS), []);
  assert.deepEqual(lastJobFindings(CI, good), []);
  const broken = (from: string, to: string): string[] => {
    assert.ok(good.includes(from), `the sample holds no ${from}`);
    return lastJobFindings(CI, good.replace(from, to));
  };
  assert.deepEqual(lastJobFindings(CI, GOOD), [`${CI}: the last job is shared, not ci-passed`]);
  assert.deepEqual(lastJobFindings(CI, `${good}  later:\n    runs-on: ubuntu-26.04-arm\n`), [`${CI}: the last job is later, not ci-passed`]);
  assert.deepEqual(lastJobFindings(CI, 'name: ci\njobs:\n'), [`${CI}: has no job`]);
  assert.deepEqual(broken('    if: ${{ always() }}\n', ''), [`${CI}: the job ci-passed has the condition none, not \${{ always() }}`]);
  assert.deepEqual(broken('if: ${{ always() }}', 'if: ${{ success() }}'), [`${CI}: the job ci-passed has the condition \${{ success() }}, not \${{ always() }}`]);
  assert.deepEqual(broken('needs: [shared, rust]', 'needs: [shared]'), [`${CI}: the job ci-passed needs shared, not every other job: shared, rust`]);
  assert.deepEqual(broken('    needs: [shared, rust]\n', ''), [`${CI}: the job ci-passed needs no job, not every other job: shared, rust`]);
  assert.deepEqual(broken('needs: [shared, rust]', 'needs: [shared, rust, other]'), [`${CI}: the job ci-passed needs shared, rust, other, not every other job: shared, rust`]);
  assert.deepEqual(broken('          RESULTS: ${{ toJSON(needs) }}\n', ''), [`${CI}: the job ci-passed does not pass RESULTS, the JSON of its needs`]);
  assert.deepEqual(broken('run: make ci-passed FAIL_SKIPPED=1', 'run: make ci-passed'), [`${CI}: the job ci-passed does not run make ci-passed FAIL_SKIPPED=1`]);
});

test('the Makefile rules name their targets', () => {
  assert.deepEqual([...makeTargets('A := b\n.PHONY: x\nx y: z\n\trun: it\nbindings-%: w\ntest-php: export PHP := php\n')].sort(), ['test-php', 'x', 'y']);
});

test('the workflows and the actions of the repository keep the rules', () => {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '.github'], { encoding: 'utf8' }).split('\0').filter((file) => file !== '');
  const workflows = tracked.filter((file) => /^\.github\/workflows\/[^/]+\.yml$/.test(file));
  const actionFiles = tracked.filter((file) => /^\.github\/actions\/[^/]+\/action\.yml$/.test(file));
  assert.deepEqual(tracked.filter((file) => !workflows.includes(file) && !actionFiles.includes(file)), [], 'a tracked file of .github is no workflow and no action');
  for (const file of [CI, RELEASE]) assert.ok(workflows.includes(file), `${file} is not tracked`);
  const targets = makeTargets(readFileSync(join(root, 'Makefile'), 'utf8'));
  // A job may call a workflow of the repository, which the test reads as every other workflow.
  const actions = new Set([...actionFiles.map((file) => `./${dirname(file)}`), ...workflows.map((file) => `./${file}`)]);
  const found = [...workflows, ...actionFiles].flatMap((file) => findings(file, readFileSync(join(root, file), 'utf8'), targets, actions));
  found.push(...triggerFindings(CI, readFileSync(join(root, CI), 'utf8')));
  found.push(...lastJobFindings(CI, readFileSync(join(root, CI), 'utf8')));
  assert.ok(workflows.includes(ASSETS), `${ASSETS} is not tracked`);
  found.push(...platformFindings(ASSETS, readFileSync(join(root, ASSETS), 'utf8')));
  assert.deepEqual(found, []);
});

const PLATFORM = `name: assets
jobs:
  platform:
    strategy:
      matrix:
        include:
          - platform: linux-x64-gnu
            runner: ubuntu-26.04
          - platform: linux-arm64-gnu
            runner: ubuntu-26.04-arm
          - platform: darwin-arm64
            runner: macos-15
    runs-on: \${{ matrix.runner }}
    steps:
      - run: make docs-check
  npm:
    runs-on: ubuntu-26.04-arm
    steps:
      - run: make docs-check
`;

test('the job platform of assets.yml alone runs on the runner of each platform of the release', () => {
  assert.deepEqual(findings(ASSETS, PLATFORM, TARGETS, ACTIONS), []);
  assert.deepEqual(platformFindings(ASSETS, PLATFORM), []);
  const broken = (from: string, to: string): string[] => {
    assert.ok(PLATFORM.includes(from), `the sample holds no ${from}`);
    const text = PLATFORM.replace(from, to);
    return [...findings(ASSETS, text, TARGETS, ACTIONS), ...platformFindings(ASSETS, text)];
  };
  // The runner of a matrix in another workflow is a runner that is not ubuntu-26.04-arm.
  assert.deepEqual(findings(CI, PLATFORM, TARGETS, ACTIONS), [`${CI}:13: runs on \${{ matrix.runner }}, not on ${RUNNER}`]);
  assert.deepEqual(broken('runner: ubuntu-26.04\n', 'runner: ubuntu-24.04\n'), [`${ASSETS}: the job platform runs on {"linux-x64-gnu":"ubuntu-24.04","linux-arm64-gnu":"ubuntu-26.04-arm","darwin-arm64":"macos-15"}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`]);
  assert.deepEqual(broken('          - platform: darwin-arm64\n            runner: macos-15\n', ''), [`${ASSETS}: the job platform runs on {"linux-x64-gnu":"ubuntu-26.04","linux-arm64-gnu":"ubuntu-26.04-arm"}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`]);
  assert.deepEqual(broken('    runs-on: ${{ matrix.runner }}', '    runs-on: macos-15'), [`${ASSETS}:13: runs on macos-15, not on ${RUNNER}`, `${ASSETS}: the job platform does not run on ${MATRIX_RUNNER}`]);
  assert.deepEqual(broken('  npm:\n    runs-on: ubuntu-26.04-arm', '  npm:\n    runs-on: ${{ matrix.runner }}'), [`${ASSETS}: the job npm runs on the runner of a matrix`]);
  assert.deepEqual(platformFindings(ASSETS, PLATFORM.replace('  platform:', '  build:')), [`${ASSETS}: the job build runs on the runner of a matrix`, `${ASSETS}: has no job platform`]);
});
