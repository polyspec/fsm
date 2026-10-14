// Writing the files of the compiler: a file that a reader never finds half written, and the text of a JSON file.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Writes `content` to `file` through a file of this process beside it and a rename; creates the directory. */
export function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.next-${process.pid}`;
  writeFileSync(next, content);
  renameSync(next, file);
}

/** The text of `value` as a JSON file: two spaces of indentation and a final line break. */
export const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
