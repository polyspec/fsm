// Tests of the command fsm-gui (docs/plans/execution-checklist.md, S-18-1): `npm install -g ./packages/gui` puts fsm-gui
// on the PATH. The package is installed offline into a temporary npm prefix; the command serves a temporary json project,
// run from the bin directory as a shell would run it, and answers the list of machines.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = path.resolve(PACKAGE, '../..');
const temp = mkdtempSync(path.join(tmpdir(), 'fsm-gui-command-'));

after(() => rmSync(temp, { recursive: true, force: true }));

/** A port that is free on 127.0.0.1 now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('npm install -g of the package gives the command fsm-gui', async (t) => {
  const prefix = path.join(temp, 'prefix');
  const install = spawnSync('npm', ['install', '-g', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', PACKAGE], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const project = path.join(temp, 'project');
  mkdirSync(path.join(project, 'machines'), { recursive: true });
  writeFileSync(path.join(project, 'fsm.config.json'), JSON.stringify({ store: 'json' }));
  copyFileSync(path.join(ROOT, 'contracts/machines/order.fsm.json'), path.join(project, 'machines/order.fsm.json'));
  // The project holds the lock entry of its own machine only (S-40): the root lock names every machine of the repository.
  const rootLock = JSON.parse(readFileSync(path.join(ROOT, 'contracts/fsm.lock.json'), 'utf8'));
  assert.ok(Object.hasOwn(rootLock, 'order'), 'the root lock has the order entry');
  writeFileSync(path.join(project, 'fsm.lock.json'), JSON.stringify({ order: rootLock.order }, null, 2) + '\n');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(project, 'fsm.lock.json'), 'utf8'))), ['order']);
  const port = await freePort();
  const server = spawn(path.join(prefix, 'bin', 'fsm-gui'), ['--project', project, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  t.after(() => server.kill());
  let response;
  for (let attempt = 0; attempt < 100 && response === undefined; attempt += 1) {
    if (server.exitCode !== null) assert.fail(`fsm-gui exited with ${server.exitCode}: ${output}`);
    response = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
    if (response === undefined) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(response, `fsm-gui did not answer: ${output}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<a href="\/machines\/order">order<\/a>/);
});
