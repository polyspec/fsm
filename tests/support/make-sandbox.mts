// What the tests that run `make -n` on a copy of the Makefile share: the files of the copy, the environment of a make run without
// inherited make flags, and the search of a line in the printed recipes.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';

/** The files that a copy of the Makefile reads: the Makefile, the kit targets and the kinds of config/parity.json. */
const MAKE_FILES = ['Makefile', 'config/parity.json'];

/** Copies the Makefile and the config it reads from the checkout `root` into the repository folder `tmp/fsm`, links the kit
 * checkout as `tmp/kit`, so that the Makefile's include of ../kit resolves as it does in the checkout, and links the tools of the
 * main checkout as `var/tools/bin` (K519: a worktree runs the tools of the main checkout), and makes `tmp/fsm` a git work tree, which
 * the tools of kit require. Returns the folder. */
export function copyMakeFiles(root: string, tmp: string): string {
  const dir = path.join(tmp, 'fsm');
  mkdirSync(dir, { recursive: true });
  for (const file of MAKE_FILES) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(root, file), path.join(dir, file));
  }
  symlinkSync(path.resolve(root, '../kit'), path.join(tmp, 'kit'));
  // The Makefile includes node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk: the installed kit of the checkout, which CI installs as a
  // package and a dev checkout links, is linked into the copy the same way.
  mkdirSync(path.join(dir, 'node_modules/@polyspec'), { recursive: true });
  symlinkSync(path.resolve(root, 'node_modules/@polyspec/kit'), path.join(dir, 'node_modules/@polyspec/kit'));
  const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  mkdirSync(path.join(dir, 'var/tools'), { recursive: true });
  symlinkSync(path.join(path.dirname(common), 'var/tools/bin'), path.join(dir, 'var/tools/bin'));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

/** The environment of a make run, with no inherited make flags. */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MAKEFLAGS;
  delete env.MAKELEVEL;
  delete env.MFLAGS;
  return env;
}

/** The index of the first line of `output` that matches `pattern`, or -1. */
export function lineIndex(output: string, pattern: RegExp): number {
  return output.split('\n').findIndex(line => pattern.test(line));
}
