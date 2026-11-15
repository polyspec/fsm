#!/usr/bin/env node
// The tools and the targets of a job of the CI pipeline, read from the plan that kit computes from config/ci.json
// (docs/plans/fsm-v1/plan.md, C-10; docs/plans/fsm-v1/checklist.md, S-484).
//
//   node scripts/ci-plan.mts <ci-setup> tools|targets shared
//   node scripts/ci-plan.mts <ci-setup> tools|targets runtime <runtime>
//
// <ci-setup> is the utility ci-setup of the installed kit. The plan job of the pipeline writes the plan into the outputs of
// GitHub with make kit-ci-plan, and the matrix of the runtime jobs fans out from them; the recipes ci-shared and ci-runtime of
// the Makefile read the tools and the targets of their job from the same plan with this script, so a local run installs and
// checks what the job of CI does. The script runs `ci-setup --plan` with GITHUB_OUTPUT empty, which prints the plan as JSON,
// and prints the words of the list that the arguments select on one line. A list of no word prints an empty line. A usage
// error exits 2; a plan that kit does not write, or that names no such runtime, exits 1 with the reason.
import { spawnSync } from 'node:child_process';

const USAGE = 'usage: scripts/ci-plan.mts <ci-setup> tools|targets shared | scripts/ci-plan.mts <ci-setup> tools|targets runtime <runtime>';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The words of `value`, a list of strings that `what` names; throws when it is another value. */
function words(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((word): word is string => typeof word === 'string')) throw new Error(`${what} of the plan is no list of strings`);
  return value;
}

/** The list `list` of the plan `plan` for the group `group` and, of the group runtime, the runtime `runtime`. */
function select(plan: unknown, list: 'tools' | 'targets', group: 'shared' | 'runtime', runtime: string | undefined): string[] {
  if (!isRecord(plan)) throw new Error('the plan is no object');
  if (group === 'shared') return list === 'tools' ? words(plan.commonTools, 'commonTools') : words(plan.sharedTargets, 'sharedTargets');
  const runtimes: unknown = plan.runtimes;
  if (!Array.isArray(runtimes)) throw new Error('runtimes of the plan is no list');
  const entries: unknown[] = runtimes;
  const job = entries.find((entry) => isRecord(entry) && entry.runtime === runtime);
  if (!isRecord(job)) throw new Error(`the plan holds no runtime ${String(runtime)}; it holds ${entries.map((entry) => (isRecord(entry) ? String(entry.runtime) : '?')).join(', ')}`);
  return list === 'tools' ? words(job.installTools, `installTools of ${String(runtime)}`) : words(job.targets, `targets of ${String(runtime)}`);
}

const [ciSetup, list, group, runtime, ...rest] = process.argv.slice(2);
if (ciSetup === undefined || (list !== 'tools' && list !== 'targets') || !((group === 'shared' && runtime === undefined) || (group === 'runtime' && runtime !== undefined && runtime !== '')) || rest.length > 0) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const result = spawnSync(process.execPath, [ciSetup, '--plan'], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
if (result.error !== undefined) {
  process.stderr.write(`ci-plan: ${ciSetup} could not start: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(`ci-plan: ${ciSetup} --plan ended with ${result.signal ?? String(result.status)}\n`);
  process.exit(1);
}
try {
  const plan: unknown = JSON.parse(result.stdout);
  process.stdout.write(`${select(plan, list, group, runtime).join(' ')}\n`);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  process.stderr.write(`ci-plan: ${error.message}\n${result.stdout}`);
  process.exit(1);
}
