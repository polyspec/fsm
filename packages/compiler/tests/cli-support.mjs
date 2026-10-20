// What the tests of the command line of fsm-gen share: the temporary directories that are removed when the file's tests end, a
// project directory made from a map of files, and the run of fsm-gen with its exit code, stdout and stderr.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.resolve(HERE, '../src/cli/fsm-gen.mjs');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A new temporary directory named by `prefix`, removed when the file's tests end. */
export function tempDir(prefix = 'fsm-gen-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** A new temporary directory with the files of `files` (path -> text), removed when the file's tests end. */
export function project(files = {}, prefix = 'fsm-gen-') {
  const root = tempDir(prefix);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

/** Runs the command line of fsm-gen with `args` in `cwd` and returns its status, stdout and stderr. */
export function gen(args, cwd = HERE) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
