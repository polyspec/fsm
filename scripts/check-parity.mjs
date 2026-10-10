#!/usr/bin/env node
// Checks that every language package ran every vector case once and passed (`make parity-check`, `make parity-<kind>`):
//
//   node scripts/check-parity.mjs [--tools <target>,...]   every kind of contracts/layout.json and the records of the tool tests
//   node scripts/check-parity.mjs --kind <kind>            the record of one kind only
//
// The cases are the vectors of conformance/vectors/*.json, `{ machine, cases: [{ feature, id, ... }] }`; a case is named
// `test_<feature>__<id>`, and every feature of contracts/features.json has at least one case. A record is the file
// .results/<name>.json that `scripts/kit/run-tests.mjs --results` writes. The check fails when
//
//   - a record is missing, does not cover its package, or is stale (its inputs digest differs from the current files);
//   - a kind did not run a vector case, ran one twice, or ran a case that no vector holds;
//   - a case of a record has any status but pass (fail, timeout and skip all fail);
//   - a test id names two or more cases, or names none and is not the parent of a test that names one (such as the Go test
//     function that runs the cases as subtests);
//   - a record ran longer than 600000 ms.
//
// There is no exemption: every kind runs the same cases at the same level. Each finding is one line on standard error;
// the command exits with status 1 when there is one.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isMain } from './kit/paths.mjs';
import { inputsDigest } from './kit/tracked-files.mjs';

export const FEATURES = 'contracts/features.json';
export const VECTORS = 'conformance/vectors';
export const LIMIT_MS = 600_000;
const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const CASE_NAME = /\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/g;

const finding = message => ({ message });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** The vector case names of the checkout with the findings of the features and the vectors. */
function cases(root) {
  const found = [];
  if (!existsSync(path.join(root, FEATURES))) return { names: null, found: [finding(`${FEATURES} does not exist; it lists the features that every kind implements`)] };
  const features = readJson(path.join(root, FEATURES)).features;
  const directory = path.join(root, VECTORS);
  const files = existsSync(directory) ? readdirSync(directory).filter(file => file.endsWith('.json')).sort() : [];
  if (files.length === 0) return { names: null, found: [finding(`${VECTORS} holds no vector file; status-gen vectors writes them`)] };
  const names = new Set();
  const covered = new Set();
  for (const file of files) {
    const where = `${VECTORS}/${file}`;
    const vectors = readJson(path.join(directory, file));
    for (const entry of vectors.cases) {
      if (!features.includes(entry.feature)) {
        found.push(finding(`${where} holds the case ${entry.id} of the feature ${entry.feature}, which ${FEATURES} does not list`));
        continue;
      }
      if (!ID.test(entry.id) || !entry.id.startsWith(`${vectors.machine}_`)) {
        found.push(finding(`${where} holds the case id ${JSON.stringify(entry.id)}; an id is lower case words joined by single underscores and starts with ${vectors.machine}_`));
        continue;
      }
      const name = `test_${entry.feature}__${entry.id}`;
      if (names.has(name)) found.push(finding(`${where} holds the case ${name} twice`));
      names.add(name);
      covered.add(entry.feature);
    }
  }
  for (const feature of features.filter(entry => !covered.has(entry))) found.push(finding(`the feature ${feature} has no vector case in ${VECTORS}`));
  return { names, found };
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

const statusFindings = (label, record) => record.cases.filter(entry => entry.status !== 'pass').map(entry => finding(`${label}: ${entry.id} is ${entry.status}; every case passes`));

/** The findings of the record of `kind` against the vector case `names`. */
function kindFindings(root, kind, names) {
  const fix = `run make test-${kind}`;
  const { record, found } = readRecord(root, kind, `packages/status-${kind}`, { missing: file => `the kind ${kind} has no result ${file}; ${fix}`, fix });
  if (!record) return found;
  const named = record.cases.map(entry => ({ entry, names: [...new Set(entry.id.match(CASE_NAME) ?? [])] }));
  const runs = new Map();
  for (const { entry, names: matched } of named) {
    found.push(...statusFindings(kind, { cases: [entry] }));
    if (matched.length > 1) found.push(finding(`${kind}: the id ${entry.id} names ${matched.length} cases; a test names one case`));
    else if (matched.length === 1) runs.set(matched[0], (runs.get(matched[0]) ?? 0) + 1);
    else if (!named.some(other => other.names.length === 1 && other.entry.id.startsWith(`${entry.id} › `))) {
      found.push(finding(`${kind}: the id ${entry.id} names no case and is not the parent of one; a test of a language package runs a vector case`));
    }
  }
  if (names) {
    for (const [name, count] of runs) if (count > 1) found.push(finding(`${kind} ran ${name} ${count} times; every case runs once`));
    for (const name of names) if (!runs.has(name)) found.push(finding(`${kind} did not run ${name}`));
    for (const name of runs.keys()) if (!names.has(name)) found.push(finding(`${kind} ran ${name}, which no vector of ${VECTORS} holds`));
  }
  return found;
}

/** The findings of the checkout `root`: every kind and the `tools` records, or the record of `kind` alone. */
export function parityFindings(root, { kind, tools = [] } = {}) {
  const layout = readJson(path.join(root, 'contracts/layout.json'));
  const kinds = Object.keys(layout.kinds).sort();
  if (kind !== undefined && !kinds.includes(kind)) return [finding(`--kind ${kind} is not a kind of contracts/layout.json`)];
  const { names, found } = cases(root);
  for (const entry of kind === undefined ? kinds : [kind]) found.push(...kindFindings(root, entry, names));
  if (kind === undefined) {
    for (const tool of tools) {
      const fix = `run make ${tool}`;
      const read = readRecord(root, tool, null, { missing: file => `the tool test ${tool} has no result ${file}; ${fix}`, fix });
      found.push(...read.found);
      if (read.record) found.push(...statusFindings(tool, read.record));
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
  console.log(`[check-parity] ${count} kinds ran ${cases(root).names.size} cases each and passed`);
}
