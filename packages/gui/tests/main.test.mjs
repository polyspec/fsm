// Tests of the server entry packages/gui/src/main.mjs as a process (docs/plans/fsm-v1/plan.md, C-7): a usage error exits
// 2, a configuration finding exits 1 and prints the finding, and the server answers the machine list over HTTP with the
// sessions directory created in the project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { orderProject, startGui, tempProject } from './helpers.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(GUI, 'src', 'main.mjs');

test('an unknown option exits 2 with the usage', () => {
  const run = spawnSync(process.execPath, [MAIN, '--bogus'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage: fsm-gui \[--project/);
});

test('a port that is not a number exits 2', () => {
  const run = spawnSync(process.execPath, [MAIN, '--port', 'eighty'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--port takes a port number/);
});

test('a project whose configuration names the db store without a DSN exits 1 and prints the finding', () => {
  const root = tempProject({ 'fsm.config.json': '{"store":"db","dsnEnv":"FSM_DSN"}\n' });
  const run = spawnSync(process.execPath, [MAIN, '--project', root], { encoding: 'utf8', env: { ...process.env, FSM_DSN: '' } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /\[fsm-gui\] E_STORE_NOT_CONFIGURED - \$\.dsnEnv: the environment variable FSM_DSN is not set/);
});

test('the server answers the machine list over HTTP and creates the sessions directory in the project', async t => {
  const root = orderProject();
  const { child, url } = await startGui(root);
  t.after(() => child.kill('SIGTERM'));
  const response = await fetch(`${url}/`, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<a href="\/machines\/order">order<\/a>/);
  const detail = await fetch(`${url}/machines/order`, { headers: { Accept: 'text/html' } });
  assert.equal(detail.status, 200);
  assert.equal(existsSync(path.join(root, 'var', 'sessions')), true);
});
