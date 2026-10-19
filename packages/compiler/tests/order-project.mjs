// The order example as a project of its own (docs/plans/fsm-v1/plan.md, C-5). The golden files of the backends and the gen commands
// that compare with them are the output for the order machine alone, so these tests read this project: the machine, the config
// and the lock entry of order, copied from the repository at import. The repository holds more machines (machines/), whose
// output is checked by the package tests and gen-check. The directory is removed when the test process exits.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The directory of the order project: machines/order.fsm.json, fsm.config.json and fsm.lock.json with the order entry only. */
export const ORDER_PROJECT = mkdtempSync(path.join(tmpdir(), 'fsm-order-project-'));
process.on('exit', () => rmSync(ORDER_PROJECT, { recursive: true, force: true }));
mkdirSync(path.join(ORDER_PROJECT, 'machines'));
copyFileSync(path.join(ROOT, 'contracts/machines/order.fsm.json'), path.join(ORDER_PROJECT, 'machines/order.fsm.json'));
copyFileSync(path.join(ROOT, 'contracts/fsm.config.json'), path.join(ORDER_PROJECT, 'fsm.config.json'));
const lock = JSON.parse(readFileSync(path.join(ROOT, 'contracts/fsm.lock.json'), 'utf8'));
writeFileSync(path.join(ORDER_PROJECT, 'fsm.lock.json'), `${JSON.stringify({ order: lock.order }, null, 2)}\n`);
