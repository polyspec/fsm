#!/usr/bin/env node
// Builds the documentation site and fails a build that prints an error (docs/plans/fsm-v1/plan.md, C-8; checklist S-473).
//
//   node scripts/docs-build.mts <docs directory>
//
// The command runs the VitePress of `<docs directory>/node_modules` as `vitepress build <docs directory>` and writes the
// output of the build as it arrives. VitePress prints the error of a page that fails to render, builds the other pages and
// ends with status 0, so the site has a page without its content. The command ends with the status of the build, and with
// status 1 when the build ended with 0 and its output holds an error line; it then names each such line on standard error.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

// An error line starts with the name of an error (`TypeError:`, `Error:`) or with `error`, after the ANSI colour codes are
// removed.
const ERROR = /^(?:[A-Za-z]*Error\b|error\b)/;

/** The error lines of the output of a build. */
export function errorLines(output: string): string[] {
  return stripVTControlCharacters(output).split('\n').filter(line => ERROR.test(line.trim()));
}

/** Runs the build of the site of `docs`, writes its output and gives its status and the output. */
function build(docs: string): Promise<{ status: number; output: string }> {
  return new Promise((resolve, reject) => {
    const vitepress = path.join(docs, 'node_modules/vitepress/bin/vitepress.js');
    const child = spawn(process.execPath, [vitepress, 'build', docs], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: string[] = [];
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      chunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal !== null) reject(new Error(`the build of ${docs} was ended by ${signal}`));
      else resolve({ status: code ?? 1, output: chunks.join('') });
    });
  });
}

if (import.meta.main) {
  const [docs, ...rest] = process.argv.slice(2);
  if (docs === undefined || rest.length > 0) {
    process.stderr.write('usage: node scripts/docs-build.mts <docs directory>\n');
    process.exitCode = 2;
  } else {
    const { status, output } = await build(path.resolve(docs));
    const errors = errorLines(output);
    process.exitCode = status;
    if (status === 0 && errors.length > 0) {
      process.stderr.write(`docs-build: the build ended with status 0 and printed ${String(errors.length)} error line${errors.length === 1 ? '' : 's'}; a page that failed to render has no content:\n`);
      for (const line of errors) process.stderr.write(`  ${line.trim()}\n`);
      process.exitCode = 1;
    }
  }
}
