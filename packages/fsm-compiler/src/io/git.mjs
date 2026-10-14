// Git in a checkout: `git` returns the output and throws when git does not exit with status 0; `gitResult` returns the
// outcome for a command whose exit status is an answer, such as `git rev-parse --verify --quiet`.
import { spawnSync } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

/** The outcome `{ status, stdout, stderr, error }` of `git <args>` in `root`, with the output as text. */
export const gitResult = (root, ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });

/** The standard output of `git <args>` in `root`; throws with the command, the exit status and the standard error otherwise. */
export function git(root, ...args) {
  const result = gitResult(root, ...args);
  const command = ['git', ...args].join(' ');
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}
