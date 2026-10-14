#!/usr/bin/env node
// Checks that the generated files equal the files of the working tree (docs/plans/fsm-v1.md, C-5; `make gen-check`):
//
//   node scripts/gen-check.mts [--root <dir>]
//
// It regenerates into var/gen-check/: the vectors (fsm-gen vectors --out var/gen-check/contracts/conformance/vectors.json) and, for each
// kind (an implementation of config/parity.json, the one list of the kinds), the generated files of its package, the first
// root of the implementation (make -C <root> gen DEST=<var/gen-check/<kind>>). It then compares the tracked and non-ignored files of the working tree
// (trackedFiles of @polyspec/kit) with the generated contracts/conformance/vectors.json and, per kind, with the files that the kind's
// globs of config/gen-check.json match: the same set of files with the same bytes. A kind without globs, or globs of a name
// that is no kind, is a finding (rule `gen-config`). Each difference is one line on standard error,
// `[gen-check] <rule> <path>: <message>`:
//
//   missing   generated, but not in the working tree
//   extra     in the working tree, but not generated
//   differs   in both, with other bytes
//
// A generation failure is a finding too (rule `generate`). The command exits with status 1 when there is one.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { trackedFiles } from '@polyspec/kit/tracked-files';
import picomatch from 'picomatch';

export const PARITY = 'config/parity.json';
export const GENERATED = 'config/gen-check.json';
export const OUT = 'var/gen-check';
const VECTORS = 'contracts/conformance/vectors.json';
const PROJECT = 'contracts';
const CLI = 'packages/compiler/src/cli/fsm-gen.mjs';

const finding = (rule, file, message) => ({ rule, path: file, message });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** The files below `dir` as paths relative to it with `/` separators; none when the directory does not exist. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(dir, rel);
    return entry.isFile() ? [rel] : [];
  });
}

/** Runs the generators into a fresh var/gen-check; the findings of the first one that fails, or none. */
function generate(root, packages) {
  rmSync(path.join(root, OUT), { recursive: true, force: true });
  const out = path.join(root, OUT, VECTORS);
  const vectors = spawnSync(process.execPath, [path.join(root, CLI), 'vectors', '--project', path.join(root, PROJECT), '--out', out], { encoding: 'utf8' });
  if (vectors.status !== 0) return [finding('generate', VECTORS, `fsm-gen vectors failed: ${vectors.stderr.trim()}`)];
  for (const [kind, dir] of packages) {
    const dest = `DEST=${path.join(root, OUT, kind)}`;
    const make = spawnSync('make', ['-C', path.join(root, dir), 'gen', dest], { encoding: 'utf8' });
    if (make.status !== 0) return [finding('generate', dir, `make gen failed: ${make.stderr.trim()}`)];
  }
  return [];
}

/** The order of two paths by their UTF-16 code units, the order of Array.prototype.sort without a compare function. */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The findings of one compared area: `base` is the directory of the tree, `dir` the generated directory, `select` the files. */
function compareArea(root: string, { base, dir, select }: { base: string; dir: string; select: (rel: string) => boolean }) {
  const tree = new Map<string, string>(trackedFiles(root)
    .filter(file => file.startsWith(`${base}/`) && select(file.slice(base.length + 1)))
    .map(file => [file.slice(base.length + 1), path.join(root, file)]));
  const generated = new Map<string, string>(filesUnder(dir).filter(select).map(rel => [rel, path.join(dir, rel)]));
  const found = [];
  for (const rel of [...new Set([...tree.keys(), ...generated.keys()])].sort(byCodeUnits)) {
    const file = `${base}/${rel}`;
    if (!generated.has(rel)) found.push(finding('extra', file, 'is in the working tree, but the generator does not write it'));
    else if (!tree.has(rel)) found.push(finding('missing', file, 'is written by the generator, but it is not in the working tree'));
    else if (!readFileSync(tree.get(rel)).equals(readFileSync(generated.get(rel)))) {
      found.push(finding('differs', file, 'has other bytes than the generated file'));
    }
  }
  return found;
}

/** The findings of the checkout `root`: a kind without generated globs, globs of no kind, a generation failure, or every difference. */
export function genCheckFindings(root) {
  const implementations = readJson(path.join(root, PARITY)).implementations;
  const kinds = implementations.map(implementation => implementation.name).sort();
  // The package of a kind is the first root of its implementation in config/parity.json.
  const packages = new Map(kinds.map(kind => [kind, implementations.find(implementation => implementation.name === kind).roots[0]]));
  const generated = readJson(path.join(root, GENERATED)).generated;
  const config = [
    ...kinds.filter(kind => !Array.isArray(generated[kind])).map(kind => finding('gen-config', GENERATED, `the kind ${kind} of ${PARITY} has no generated globs; name the files its generator writes`)),
    ...Object.keys(generated).filter(name => !kinds.includes(name)).map(name => finding('gen-config', GENERATED, `${name} is no kind of ${PARITY}`)),
  ];
  if (config.length > 0) return config;
  const failed = generate(root, packages);
  if (failed.length > 0) return failed;
  const areas = [{ base: path.posix.dirname(VECTORS), dir: path.join(root, OUT, path.posix.dirname(VECTORS)), select: rel => rel === path.posix.basename(VECTORS) }];
  for (const kind of kinds) {
    areas.push({ base: packages.get(kind), dir: path.join(root, OUT, kind), select: picomatch(generated[kind], { dot: true }) });
  }
  return areas.flatMap(area => compareArea(root, area));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const root = path.resolve(values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const found = genCheckFindings(root);
  for (const entry of found) console.error(`[gen-check] ${entry.rule} ${entry.path}: ${entry.message}`);
  if (found.length > 0) {
    console.error(`[gen-check] ${found.length} findings`);
    process.exit(1);
  }
  console.log('[gen-check] the generated files equal the working tree');
}
