#!/usr/bin/env node
// The fsm GUI server (docs/plans/fsm-v1.md, C-7):
//   fsm-gui [--project <dir>] [--port <n>]
// --project is the project root, whose fsm.config.json selects the store (default: the current directory). --port is the
// port on 127.0.0.1 (default 8080). The assets must be built first (make gui-build). The sessions are kept in
// <project>/var/sessions. A finding of the configuration prints as `[fsm-gui] <code> <machine> <path>: <message>` on stderr
// and exits 1; a usage error exits 2.

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { App, FileSessions } from '@polyspec/hyper-server';
import { handlers } from './handlers.mjs';
import { openStore } from './store.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: fsm-gui [--project <dir>] [--port <n>]';

/** Runs the server; returns the exit code. */
async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { project: { type: 'string' }, port: { type: 'string' } }, strict: true }));
  } catch (error) {
    process.stderr.write(`[fsm-gui] ${error.message}\n${USAGE}\n`);
    return 2;
  }
  const port = values.port ?? '8080';
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) {
    process.stderr.write(`[fsm-gui] --port takes a port number from 0 to 65535\n${USAGE}\n`);
    return 2;
  }
  const project = path.resolve(values.project ?? process.cwd());

  const opened = await openStore(project, process.env);
  if (opened.findings !== undefined) {
    for (const { code, machine, path: at, message } of opened.findings) {
      process.stderr.write(`[fsm-gui] ${code} ${machine ?? '-'} ${at}: ${message}\n`);
    }
    return 1;
  }

  const sessions = path.join(project, 'var', 'sessions');
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const app = await App.open({
    manifest: path.join(GUI, 'app', 'app.json'),
    templates: { index: path.join(GUI, 'build', 'templates.index.json'), root: path.join(GUI, 'public') },
    handlers,
    timezone: 'UTC',
  });
  app.bind('store', () => opened.store);
  app.bind('assets', () => JSON.parse(readFileSync(path.join(GUI, 'build', 'manifest.json'), 'utf8')));

  const server = app.server(new FileSessions({ directory: sessions }), { files: path.join(GUI, 'public') });
  const stop = () => {
    server.close();
    // A store that fails to close is a failure of the stop: it is printed and the process ends with 1, never 0.
    opened.close().then(() => process.exit(0), (error) => {
      process.stderr.write(`[fsm-gui] closing the store failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.listen(Number(port), '127.0.0.1', () => {
    process.stdout.write(`[fsm-gui] http://127.0.0.1:${server.address().port} project ${project}\n`);
  });
  return 0;
}

main(process.argv.slice(2)).then(
  code => {
    if (code !== 0) process.exitCode = code;
  },
  error => {
    process.stderr.write(`[fsm-gui] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
