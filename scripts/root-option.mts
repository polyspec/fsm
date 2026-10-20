// The option --root <dir> that the checks of the root scripts take (check-name, check-readmes): the directory that they scan.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * The root directory that the arguments `argv` of the script `tool` name, or the repository root above the script at `scriptUrl`
 * when there is no --root; on an unknown option it writes the usage line and returns undefined (the script exits 2).
 */
export function rootOption(tool: string, argv: string[], scriptUrl: string): string | undefined {
  let options: { root?: string | undefined };
  try {
    options = parseArgs({ args: argv, options: { root: { type: 'string' } }, strict: true }).values;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`usage: ${tool}.mts [--root <dir>] (${error.message})\n`);
    return undefined;
  }
  return path.resolve(options.root ?? path.join(path.dirname(fileURLToPath(scriptUrl)), '..'));
}
