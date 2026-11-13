#!/usr/bin/env node
// The commands of the container program of the platform for the images of the PostgreSQL and MySQL servers of the tests
// (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475).
//
//   node scripts/container.mts program                      prints the name of the program
//   node scripts/container.mts pull <image>                 pulls the image
//   node scripts/container.mts present <image>              fails unless the image is installed; prints nothing
//
// bay starts and removes the servers (scripts/persist-servers.mts), on the container program of the platform. It has no
// command that pulls an image and starts nothing, and none that tells whether an image is installed, so these two verbs
// call that program itself until bay has them (S-475-2). The file has no verb that runs, removes or describes a container.
//
// The platform names the program: Darwin runs Apple container and Linux runs docker; the platform is what `uname -s` of
// PATH prints, as for the recipes of the Makefile. The image and its digest are one for both, so the tests of both platforms
// connect to the same bytes of the server. No variable selects the program. A program that PATH does not hold fails every
// verb at once, with its name and what installs it.
//
// The command exits with the exit code of the program, 1 for a failure of its own and 2 for a usage error.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

const USAGE = 'usage: scripts/container.mts program | pull <image> | present <image>';

/** A failure of a command of this file, which ends it with `code` and the message on standard error. */
export class ContainerError extends Error {
  code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

/** The container program of a platform. */
export type Program = 'container' | 'docker';

// The program of each platform that `uname -s` names, and what installs it.
const PLATFORMS: Record<string, { program: Program; install: string } | undefined> = {
  Darwin: { program: 'container', install: 'install Apple container (https://github.com/apple/container) and start it with `container system start`' },
  Linux: { program: 'docker', install: 'install Docker Engine (https://docs.docker.com/engine/install/) and let this user run it' },
};

/** Whether a directory of PATH holds the executable file `name`. */
export function onPath(name: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).filter(directory => directory !== '').some(directory => {
    try {
      accessSync(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The container program of the platform; fails for a platform that has none and for a program that PATH does not hold. */
export function containerProgram(): Program {
  const uname = spawnSync('uname', ['-s'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (uname.error || uname.status !== 0) throw new ContainerError(`scripts/container.mts: uname -s failed: ${uname.error?.message ?? `it ended with ${String(uname.status ?? uname.signal)}`}`);
  const system = uname.stdout.trim();
  const platform = PLATFORMS[system];
  if (platform === undefined) throw new ContainerError(`scripts/container.mts: no container program is named for ${system}: Darwin runs Apple container and Linux runs docker`);
  if (!onPath(platform.program)) throw new ContainerError(`scripts/container.mts: ${platform.program} is not found on PATH: ${platform.install}`);
  return platform.program;
}

/** A verb of this file that runs one command of the container program. */
export type Verb = 'pull' | 'present';

// The words of the command of each verb between the program and the image. Both programs name them alike.
const COMMANDS: Record<Verb, readonly string[]> = { pull: ['image', 'pull'], present: ['image', 'inspect'] };

/** The words after the program of the command of `verb` for `image`, on either program. */
export function containerCommand(verb: Verb, image: string): string[] {
  return [...COMMANDS[verb], image];
}

function isVerb(text: string): text is Verb {
  return Object.hasOwn(COMMANDS, text);
}

/** Runs the command of the arguments `argv` of this file and returns its exit code. */
function main(argv: readonly string[]): number {
  const [verb, ...args] = argv;
  if (verb === 'program' && args.length === 0) {
    process.stdout.write(`${containerProgram()}\n`);
    return 0;
  }
  const [image, ...more] = args;
  if (verb === undefined || !isVerb(verb) || image === undefined || more.length > 0) throw new ContainerError(USAGE, 2);
  const program = containerProgram();
  // present prints nothing: the description of the image that the program prints is not the output of the verb.
  const ran = spawnSync(program, containerCommand(verb, image), { stdio: ['inherit', verb === 'present' ? 'ignore' : 'inherit', 'inherit'] });
  if (ran.error) throw new ContainerError(`scripts/container.mts: ${program}: ${ran.error.message}`);
  return ran.status ?? 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ContainerError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  }
}
