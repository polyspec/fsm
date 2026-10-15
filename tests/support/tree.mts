// The temporary checkouts of the root tool tests: a Git repository holding the given files, removed after the test. The tests
// of kit's own tools live in kit; these helpers serve the tests of fsm's tools only.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** The files of a tree: the text of each path, or null to remove the file. */
export type Files = Readonly<Record<string, string | null>>;

/** A temporary Git repository holding `files` ({ path: text }), removed with `t.after`; automatic maintenance is off. */
export function tree(t: TestContext, files: Files = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-tree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const args of [['init', '--quiet', root], ['-C', root, 'config', 'maintenance.auto', 'false'], ['-C', root, 'config', 'gc.auto', '0']]) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  }
  put(root, files);
  return root;
}

/** Writes `files` ({ path: text, or null to remove }) below `root`. */
export function put(root: string, files: Files): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    if (text === null) { rmSync(target, { force: true }); continue; }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
