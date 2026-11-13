// The commands of scripts/container.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475): the
// container program is the one of the platform, Apple container on Darwin and docker on Linux, and each verb of the script
// is one command of that program. The verbs are those of an image, pull and present: bay starts and removes the servers, so
// the script has no verb that runs, removes or describes a container. The test runs the script with stand-ins that it writes
// into a directory of its own, the only programs of PATH: a uname that names the platform and a container program that
// records its arguments, so it needs no container runtime.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { standIns } from '../support/stand-ins.mts';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/container.mts');
const IMAGE = 'docker.io/library/postgres@sha256:00';

/** The result of the script: its code and output, and the commands that the container program received, each as its words. */
interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  calls: string[][];
}

/**
 * Runs the script with `args` on the platform that the stand-in uname names. `program` is the container program that PATH
 * holds, none when it is undefined.
 */
function run(t: TestContext, system: string, program: string | undefined, args: string[]): Run {
  const { directory, path: PATH, program: write } = standIns(t, system);
  const calls = path.join(directory, 'calls');
  // Each command is one line of the file calls, its words joined by a tab.
  if (program !== undefined) write(program, `line=$(basename "$0")\nfor word in "$@"; do line="$line\t$word"; done\nprintf '%s\\n' "$line" >> '${calls}'\n`);
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH } });
  assert.equal(result.error, undefined, `scripts/container.mts did not start: ${String(result.error)}`);
  const recorded = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\t')) : [];
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, calls: recorded };
}

test('on Linux each verb is one command of docker', t => {
  const linux = (args: string[]): Run => run(t, 'Linux', 'docker', args);
  const program = linux(['program']);
  assert.deepEqual([program.code, program.stdout, program.calls], [0, 'docker\n', []]);
  assert.deepEqual(linux(['pull', IMAGE]).calls, [['docker', 'image', 'pull', IMAGE]]);
  assert.deepEqual(linux(['present', IMAGE]).calls, [['docker', 'image', 'inspect', IMAGE]]);
});

test('on Darwin each verb is one command of Apple container', t => {
  const darwin = (args: string[]): Run => run(t, 'Darwin', 'container', args);
  const program = darwin(['program']);
  assert.deepEqual([program.code, program.stdout, program.calls], [0, 'container\n', []]);
  assert.deepEqual(darwin(['pull', IMAGE]).calls, [['container', 'image', 'pull', IMAGE]]);
  assert.deepEqual(darwin(['present', IMAGE]).calls, [['container', 'image', 'inspect', IMAGE]]);
});

// present prints nothing: the description of the image that the program prints is not the output of the verb.
test('present prints nothing and fails when the program fails', t => {
  const { path: PATH, program } = standIns(t, 'Linux');
  program('docker', 'echo described\n[ "$3" = installed ]\n');
  const present = (image: string) => spawnSync(process.execPath, [SCRIPT, 'present', image], { encoding: 'utf8', env: { PATH } });
  assert.deepEqual([present('installed').status, present('installed').stdout], [0, '']);
  assert.deepEqual([present('absent').status, present('absent').stdout], [1, '']);
});

test('a container program that PATH does not hold fails every verb at once, with its name and what installs it', t => {
  for (const [system, program, install] of [['Linux', 'docker', 'Docker Engine'], ['Darwin', 'container', 'Apple container']] as const) {
    for (const args of [['program'], ['pull', IMAGE], ['present', IMAGE]]) {
      const missing = run(t, system, undefined, args);
      assert.equal(missing.code, 1, `${system} ${args.join(' ')}`);
      assert.match(missing.stderr, new RegExp(`^scripts/container\\.mts: ${program} is not found on PATH: install ${install} `));
      assert.equal(missing.stdout, '');
    }
  }
});

// run, delete and inspect are no verbs: bay starts, removes and names the containers of the servers (S-475).
test('a platform without a container program and a verb that the script does not know fail', t => {
  const other = run(t, 'FreeBSD', 'docker', ['program']);
  assert.equal(other.code, 1);
  assert.match(other.stderr, /^scripts\/container\.mts: no container program is named for FreeBSD: Darwin runs Apple container and Linux runs docker\n$/);
  assert.deepEqual(other.calls, []);
  for (const args of [[], ['start'], ['list', 'run-1'], ['program', 'a'], ['pull'], ['pull', 'a', 'b'], ['present'], ['present', 'a', 'b'], ['run', 'run-1-postgres', IMAGE], ['delete', 'run-1-postgres'], ['inspect', 'run-1-postgres']]) {
    const unknown = run(t, 'Linux', 'docker', args);
    assert.equal(unknown.code, 2, args.join(' '));
    assert.match(unknown.stderr, /^usage: scripts\/container\.mts /);
    assert.deepEqual(unknown.calls, []);
  }
});

// No variable selects the program: a variable that names the other program changes no command.
test('the platform alone names the program', t => {
  const { path: PATH, program } = standIns(t, 'Darwin');
  for (const name of ['docker', 'container']) program(name, 'exit 0\n');
  const result = spawnSync(process.execPath, [SCRIPT, 'program'], { encoding: 'utf8', env: { PATH, CONTAINER_PROGRAM: 'docker', CONTAINER: 'docker', program: 'docker' } });
  assert.deepEqual([result.status, result.stdout], [0, 'container\n']);
});
