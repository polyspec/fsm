// The parts of the command line that fsm-gen and fsm-db share: the flags of a command and the run of a command with its exit
// code, its findings and its one-line summary (docs/plans/fsm-v1/plan.md, C-5 and C-6).

import path from 'node:path';

/** The value of --rename: machine.old=new. */
const RENAME = /^([^.=]+)\.([^.=]+)=([^.=]+)$/;

/** The options that every command has before its flags are read: --project is the current directory, and there is no rename. */
export const baseOptions = command => ({ command, project: process.cwd(), renames: [], root: undefined });

/**
 * Applies the flag --project, --root or --rename to `options`: true when it was one of them, { usage } when --rename has a bad value,
 * false for another flag.
 */
function commonFlag(options, flag, value) {
  if (flag === '--project') {
    options.project = path.resolve(value);
    return true;
  }
  if (flag === '--root') {
    options.root = path.resolve(value);
    return true;
  }
  if (flag === '--rename') {
    const match = RENAME.exec(value);
    if (match === null) return { usage: '--rename takes machine.old=new' };
    options.renames.push({ machine: match[1], from: match[2], to: match[3] });
    return true;
  }
  return false;
}

/**
 * Reads the flags of the arguments `rest` of `command` into `options`: each flag must be one of `allowed` and have a value;
 * --project, --root and --rename are read here, and `specific(flag, value)` reads the others and returns { usage } for a bad
 * value. The result is { usage } with the reason, or undefined when the flags are valid.
 */
export function readFlags(options, command, rest, allowed, specific) {
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!allowed.includes(flag)) return { usage: `${flag ?? 'argument'} is not an option of ${command}` };
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) return { usage: `${flag} needs a value` };
    index += 1;
    const common = commonFlag(options, flag, value);
    if (typeof common === 'object') return common;
    if (!common) {
      const bad = specific(flag, value);
      if (bad !== undefined) return bad;
    }
  }
  return undefined;
}

/**
 * Runs the command line `argv` of the tool `tool` and sets the exit code: `parse` gives the options or { usage }, `execute` the
 * findings. A usage error exits 2, a finding prints as `[tool] <code> <machine> <path>: <message>` and exits 1, and otherwise the
 * command exits 0 with a one-line summary. An unexpected rejection is never swallowed: it is printed and the command exits 1.
 */
export function runCommandLine(tool, argv, { usage, parse, execute }) {
  async function main() {
    const parsed = parse(argv);
    if ('usage' in parsed) {
      process.stderr.write(`[${tool}] usage: ${parsed.usage}\n${usage}\n`);
      return 2;
    }
    const findings = await execute(parsed);
    if (findings.length > 0) {
      for (const { code, machine, path: at, message } of findings) {
        process.stderr.write(`[${tool}] ${code} ${machine ?? '-'} ${at}: ${message}\n`);
      }
      return 1;
    }
    process.stdout.write(`[${tool}] ${parsed.command}: ok\n`);
    return 0;
  }
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      process.stderr.write(`[${tool}] ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
