#!/usr/bin/env node
// Checks the rules of the vector parity that kit's parity check (K33, config/parity.json, `make parity-check`) does not take
// (`make vector-parity-check`, `make parity-<kind>`):
//
//   node scripts/check-parity.mjs [--tools <target>,...]   every kind of contracts/layout.json and the records of the tool tests
//   node scripts/check-parity.mjs --kind <kind>            the record of one kind only
//
// K33 runs the binding of every kind and checks that each kind runs every vector case of conformance/vectors.json that admits it,
// once, and passes; it reads no saved record and has no time limit. This check reads the saved records instead. A record is the
// file .results/<name>.json that `scripts/kit/run-tests.mjs --results` writes. The check fails when
//
//   - a feature of contracts/features.json has no case in conformance/vectors.json, or the vectors hold a case of a feature that
//     contracts/features.json does not list;
//   - a record of a kind or a tool test is missing, does not cover its package, or is stale (its inputs digest differs from the
//     current files);
//   - a record ran longer than 600000 ms;
//   - a case of a tool test record has any status but pass (fail, timeout and skip all fail).
//
// Each finding is one line on standard error; the command exits with status 1 when there is one.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isMain } from './kit/paths.mjs';
import { inputsDigest } from './kit/tracked-files.mjs';

export const FEATURES = 'contracts/features.json';
export const VECTORS = 'conformance/vectors.json';
export const LIMIT_MS = 600_000;

const finding = message => ({ message });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** The findings of the features against the vectors: every feature has a case, and every case is of a listed feature. */
function featureFindings(root) {
  if (!existsSync(path.join(root, FEATURES))) return [finding(`${FEATURES} does not exist; it lists the features that every kind implements`)];
  if (!existsSync(path.join(root, VECTORS))) return [finding(`${VECTORS} does not exist; fsm-gen vectors writes it`)];
  const features = readJson(path.join(root, FEATURES)).features;
  const cases = readJson(path.join(root, VECTORS)).machines.flatMap(entry => entry.cases);
  const found = cases.filter(entry => !features.includes(entry.feature))
    .map(entry => finding(`${VECTORS} holds the case ${entry.name} of the feature ${entry.feature}, which ${FEATURES} does not list`));
  const covered = new Set(cases.map(entry => entry.feature));
  for (const feature of features.filter(entry => !covered.has(entry))) found.push(finding(`the feature ${feature} has no vector case in ${VECTORS}`));
  return found;
}

/**
 * The record `.results/<name>.json` with its findings; no record when it is missing, does not cover the package `covers` (a
 * kind) or is stale. A tool test has no package to cover (`covers` null).
 */
function readRecord(root, name, covers, rerun) {
  const file = `.results/${name}.json`;
  if (!existsSync(path.join(root, file))) return { found: [finding(rerun.missing(file))] };
  const record = readJson(path.join(root, file));
  const { paths, digest } = record.inputs;
  if (covers !== null && !paths.some(entry => entry === '.' || entry === covers || covers.startsWith(`${entry}/`))) {
    return { found: [finding(`${file} covers ${paths.join(', ')}, not ${covers}; ${rerun.fix}`)] };
  }
  let current;
  try {
    current = inputsDigest(root, paths);
  } catch (error) {
    return { found: [finding(`${file} is stale: ${error.message}; ${rerun.fix}`)] };
  }
  if (current !== digest) return { found: [finding(`${file} is stale: the files of ${paths.join(', ')} changed after the run; ${rerun.fix}`)] };
  const found = [];
  if (record.elapsedMs > LIMIT_MS) found.push(finding(`${file} ran ${record.elapsedMs} ms; a test process runs at most ${LIMIT_MS} ms`));
  return { record, found };
}

/** The findings of the checkout `root`: the features, every kind and the `tools` records, or the record of `kind` alone. */
export function parityFindings(root, { kind, tools = [] } = {}) {
  const layout = readJson(path.join(root, 'contracts/layout.json'));
  const kinds = Object.keys(layout.kinds).sort();
  if (kind !== undefined && !kinds.includes(kind)) return [finding(`--kind ${kind} is not a kind of contracts/layout.json`)];
  const found = featureFindings(root);
  for (const entry of kind === undefined ? kinds : [kind]) {
    const fix = `run make test-${entry}`;
    found.push(...readRecord(root, entry, `packages/fsm-${entry}`, { missing: file => `the kind ${entry} has no result ${file}; ${fix}`, fix }).found);
  }
  if (kind === undefined) {
    for (const tool of tools) {
      const fix = `run make ${tool}`;
      const read = readRecord(root, tool, null, { missing: file => `the tool test ${tool} has no result ${file}; ${fix}`, fix });
      found.push(...read.found);
      if (read.record) {
        found.push(...read.record.cases.filter(entry => entry.status !== 'pass').map(entry => finding(`${tool}: ${entry.id} is ${entry.status}; every case passes`)));
      }
    }
  }
  return found;
}

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { values } = parseArgs({ options: { kind: { type: 'string' }, tools: { type: 'string' } } });
  const tools = values.tools ? values.tools.split(',').filter(Boolean) : [];
  console.log(`[check-parity] reading ${VECTORS}, ${FEATURES} and ${values.kind ? `the result of ${values.kind}` : 'the results of every kind and tool test'}`);
  const found = parityFindings(root, { kind: values.kind, tools });
  for (const entry of found) console.error(`[check-parity] ${entry.message}`);
  if (found.length) {
    console.error(`[check-parity] ${found.length} findings`);
    process.exit(1);
  }
  const layout = readJson(path.join(root, 'contracts/layout.json'));
  const count = values.kind ? 1 : Object.keys(layout.kinds).length;
  console.log(`[check-parity] ${count} kinds passed: the records are present, current and within ${LIMIT_MS} ms; every feature has a vector case`);
}
