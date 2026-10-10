#!/usr/bin/env node
// Checks that the generated files equal the files of the working tree (docs/plans/status-v1.md, C-5; `make gen-check`):
//
//   node scripts/gen-check.mjs
//
// It regenerates into var/gen-check/: the vectors (status-gen vectors --out var/gen-check/conformance/vectors) and, for each
// kind of contracts/layout.json, the generated files of its package (make -C packages/status-<kind> gen DEST=<var/gen-check/
// <kind>>). It then compares the tracked and non-ignored files of the working tree (scripts/kit/tracked-files.mjs) with the
// generated files of conformance/vectors and, per kind, with the files that the kind's `generated` globs match: the same set
// of files with the same bytes. A kind without `generated` globs is a finding (rule `layout-config`). Each difference is one
// line on standard error, `[gen-check] <rule> <path>: <message>`:
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
import { matchesAny } from './kit/glob.mjs';
import { isMain } from './kit/paths.mjs';
import { trackedFiles } from './kit/tracked-files.mjs';

export const LAYOUT = 'contracts/layout.json';
export const OUT = 'var/gen-check';
const VECTORS = 'conformance/vectors';
const CLI = 'packages/status-compiler/src/cli/status-gen.mjs';

const finding = (rule, file, message) => ({ rule, path: file, message });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** The files below `dir` as paths relative to it with `/` separators; none when the directory does not exist. */
function filesUnder(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(dir, rel);
    return entry.isFile() ? [rel] : [];
  });
}

/** Runs the generators into a fresh var/gen-check; the findings of the first one that fails, or none. */
function generate(root, kinds) {
  rmSync(path.join(root, OUT), { recursive: true, force: true });
  const out = path.join(root, OUT, VECTORS);
  const vectors = spawnSync(process.execPath, [path.join(root, CLI), 'vectors', '--project', root, '--out', out], { encoding: 'utf8' });
  if (vectors.status !== 0) return [finding('generate', VECTORS, `status-gen vectors failed: ${vectors.stderr.trim()}`)];
  for (const kind of kinds) {
    const dir = `packages/status-${kind}`;
    const dest = `DEST=${path.join(root, OUT, kind)}`;
    const make = spawnSync('make', ['-C', path.join(root, dir), 'gen', dest], { encoding: 'utf8' });
    if (make.status !== 0) return [finding('generate', dir, `make gen failed: ${make.stderr.trim()}`)];
  }
  return [];
}

/** The findings of one compared area: `base` is the directory of the tree, `dir` the generated directory, `select` the files. */
function compareArea(root, { base, dir, select }) {
  const tree = new Map(trackedFiles(root)
    .filter(file => file.startsWith(`${base}/`) && select(file.slice(base.length + 1)))
    .map(file => [file.slice(base.length + 1), path.join(root, file)]));
  const generated = new Map(filesUnder(dir).filter(select).map(rel => [rel, path.join(dir, rel)]));
  const found = [];
  for (const rel of [...new Set([...tree.keys(), ...generated.keys()])].sort()) {
    const file = `${base}/${rel}`;
    if (!generated.has(rel)) found.push(finding('extra', file, 'is in the working tree, but the generator does not write it'));
    else if (!tree.has(rel)) found.push(finding('missing', file, 'is written by the generator, but it is not in the working tree'));
    else if (!readFileSync(tree.get(rel)).equals(readFileSync(generated.get(rel)))) {
      found.push(finding('differs', file, 'has other bytes than the generated file'));
    }
  }
  return found;
}

/** The findings of the checkout `root`: a layout without the generated globs of a kind, a generation failure, or every difference. */
export function genCheckFindings(root) {
  const layout = readJson(path.join(root, LAYOUT));
  const kinds = Object.keys(layout.kinds).sort();
  const withoutGlobs = kinds.filter(kind => !Array.isArray(layout.kinds[kind].generated));
  if (withoutGlobs.length > 0) {
    return withoutGlobs.map(kind => finding('layout-config', LAYOUT, `the kind ${kind} has no generated globs; name the files its generator writes`));
  }
  const failed = generate(root, kinds);
  if (failed.length > 0) return failed;
  const areas = [{ base: VECTORS, dir: path.join(root, OUT, VECTORS), select: () => true }];
  for (const kind of kinds) {
    const globs = layout.kinds[kind].generated;
    areas.push({ base: `packages/status-${kind}`, dir: path.join(root, OUT, kind), select: rel => matchesAny(globs, rel) });
  }
  return areas.flatMap(area => compareArea(root, area));
}

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = genCheckFindings(root);
  for (const entry of found) console.error(`[gen-check] ${entry.rule} ${entry.path}: ${entry.message}`);
  if (found.length > 0) {
    console.error(`[gen-check] ${found.length} findings`);
    process.exit(1);
  }
  console.log('[gen-check] the generated files equal the working tree');
}
