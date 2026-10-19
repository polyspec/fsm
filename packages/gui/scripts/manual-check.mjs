// The GUI manual check of the plan (docs/operations/verification/gui.md, checklist S-22): it drives a running fsm-gui in the Chromium of
// the pinned Playwright package and walks one store through the steps of the record: the diagram names every state, a row
// added on the edit screen holds the suggested code (6), the saved state with an edge appears in the table and the diagram,
// the removed state leaves the table and the next suggestion is 7 (the lock reserves 6), and a rename keeps the code.
// It records a video of the walk and a screenshot per step in <outDir>, prints one line per step, and exits 1 when a step fails.
//   node scripts/manual-check.mjs <baseUrl> <outDir> <label>
// The steps of docs/operations/verification/gui.md build the project of each store and start the server; this script needs the browser
// of `make gui-browsers`.
import { mkdirSync } from 'node:fs';
import strict from 'node:assert/strict';
import { chromium } from 'playwright';

// Every failed step is collected, so one run reports all of them.
const failures = [];
const assert = new Proxy(strict, { get: (target, name) => (...args) => {
  try {
    return target[name](...args);
  } catch (error) {
    failures.push(`${String(name)}: ${error.message.split('\n')[0].slice(0, 160)}`);
    return undefined;
  }
} });

const [base, out, label] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, recordVideo: { dir: out, size: { width: 1200, height: 900 } } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let step = 0;
const shot = async name => page.screenshot({ path: `${out}/${label}-${String(++step).padStart(2, '0')}-${name}.png`, fullPage: true });
const log = (...a) => console.log(`[${label}]`, ...a);

async function stateLabels() {
  // The svg element appears before mermaid has drawn its labels, so the wait is for the first label.
  await page.waitForFunction(() => [...document.querySelectorAll('pre.mermaid svg .nodeLabel, pre.mermaid svg text')].some(n => n.textContent.trim() !== ''), null, { timeout: 15000 });
  return page.locator('pre.mermaid svg').evaluate(svg => [...svg.querySelectorAll('.nodeLabel, text')].map(n => n.textContent.trim()).filter(Boolean));
}
async function stateKeys() {
  return page.locator('h2:has-text("States") + table tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent.trim()).join('|')));
}
async function save() {
  await Promise.all([page.waitForLoadState('load'), page.locator('button[type=submit]:has-text("Save")').click()]);
  await page.waitForTimeout(800);
}
const stateRows = () => page.locator('input[name^="form[states]"][name$="[key]"]');

await page.goto(`${base}/machines/order`);
log('initial states', JSON.stringify(await stateKeys()));
log('initial diagram labels', JSON.stringify(await stateLabels())); assert.ok((await stateLabels()).includes('draft'), 'the diagram names draft');
await shot('show');

// 1. add a state with an edge to it
await page.goto(`${base}/machines/order/edit`); await page.waitForSelector('#fsm-form[data-fsm-connected]');
const before = await stateRows().count();
const lastState = page.locator('input[name^="form[states]"][name$="[key]"]').nth(before - 1).locator('xpath=ancestor::*[.//button[@data-crudui-action="add-row"]][1]');
await lastState.locator('button[data-crudui-action="add-row"]').first().click();
await page.waitForTimeout(300);
const after = await stateRows().count();
log('state rows', before, '->', after); assert.equal(after, before + 1, 'add adds a row');
const newKey = stateRows().nth(after - 1);
const newName = await newKey.getAttribute('name');
const prefix = newName.slice(0, newName.length - '[key]'.length);
const suggested = await page.locator(`input[name="${prefix}[code]"]`).inputValue();
log('suggested code of the added row:', suggested); assert.equal(suggested, '6');
await page.locator(`input[name="${prefix}[newKey]"]`).fill('refunded');
await page.locator(`input[name="${prefix}[final]"]`).check();
const cancelEdges = page.locator('input[name^="form[events][__0000000000003__][edges]"][name$="[from]"]');
const edgeCount = await cancelEdges.count();
await cancelEdges.nth(edgeCount - 1).locator('xpath=ancestor::*[.//button[@data-crudui-action="add-row"]][1]').locator('button[data-crudui-action="add-row"]').first().click();
await page.waitForTimeout(300);
const newFrom = page.locator('input[name^="form[events][__0000000000003__][edges]"][name$="[from]"], select[name^="form[events][__0000000000003__][edges]"][name$="[from]"]').nth(edgeCount);
const fromName = await newFrom.getAttribute('name');
const edgePrefix = fromName.slice(0, fromName.length - '[from]'.length);
const fill = async (name, value) => {
  const el = page.locator(`[name="${name}"]`);
  if ((await el.evaluate(e => e.tagName)) === 'SELECT') await el.selectOption(value); else await el.fill(value);
};
await fill(`${edgePrefix}[from]`, 'shipped');
await fill(`${edgePrefix}[to]`, 'refunded');
await shot('add-filled');
await save();
log('after add, url', page.url());
const added = await stateKeys(); log('states', JSON.stringify(added)); assert.ok(added.includes('refunded|6|-|yes'), 'refunded|6 listed');
assert.ok((await stateLabels()).includes('refunded'), 'the diagram names refunded');
await shot('added');

// 2. delete that state and its edge
await page.goto(`${base}/machines/order/edit`); await page.waitForSelector('#fsm-form[data-fsm-connected]');
const rows = await stateRows().count();
const refundedIndex = (await stateRows().evaluateAll(es => es.map(e => e.value))).indexOf('refunded'); assert.notEqual(refundedIndex, -1, 'refunded is stored');
await stateRows().nth(refundedIndex).locator('xpath=ancestor::*[.//button[@data-crudui-action="remove-row"]][1]').locator('button[data-crudui-action="remove-row"]').first().click();
const tos = page.locator('[name^="form[events][__0000000000003__][edges]"][name$="[to]"]');
const toValues = await tos.evaluateAll(es => es.map(e => e.value));
await tos.nth(toValues.indexOf('refunded')).locator('xpath=ancestor::*[.//button[@data-crudui-action="remove-row"]][1]').locator('button[data-crudui-action="remove-row"]').first().click();
await page.waitForTimeout(300);
log('state rows', rows, '->', await stateRows().count());
await shot('delete-filled');
await save();
log('after delete, url', page.url());
const deleted = await stateKeys(); log('states', JSON.stringify(deleted)); assert.ok(!deleted.some(r => r.startsWith('refunded|')), 'refunded removed');
await shot('deleted');

// 3. a state added after the delete gets the next code, not the reserved one
await page.goto(`${base}/machines/order/edit`); await page.waitForSelector('#fsm-form[data-fsm-connected]');
const n = await stateRows().count();
await stateRows().nth(n - 1).locator('xpath=ancestor::*[.//button[@data-crudui-action="add-row"]][1]').locator('button[data-crudui-action="add-row"]').first().click();
await page.waitForTimeout(300);
const name2 = await stateRows().nth(n).getAttribute('name');
const after2 = await page.locator(`input[name="${name2.slice(0, -5)}[code]"]`).inputValue(); log('suggested code after the delete:', after2); assert.equal(after2, '7', 'the reserved 6 is not suggested');

// 4. rename paid -> settled
await page.goto(`${base}/machines/order/rename`); await page.waitForSelector('form button[type=submit]');
const renameKeys = page.locator('input[name$="[key]"]');
const keys = await renameKeys.evaluateAll(es => es.map(e => e.value));
const paidName = await renameKeys.nth(keys.indexOf('paid')).getAttribute('name');
await page.locator(`input[name="${paidName.slice(0, -5)}[to]"]`).fill('settled');
await shot('rename-filled');
await save();
log('after rename, url', page.url());
const renamed = await stateKeys(); log('states', JSON.stringify(renamed)); assert.ok(renamed.includes('settled|2|-|-'), 'settled keeps code 2');
assert.ok((await stateLabels()).includes('settled'), 'the diagram names settled');
await shot('renamed');

log('browser errors', JSON.stringify(errors)); assert.deepEqual(errors, []);
await context.close();
console.log(`[${label}] failures: ${failures.length}`);
for (const failure of failures) console.log(`[${label}]   ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
await browser.close();
