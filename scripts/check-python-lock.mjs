#!/usr/bin/env node
// The lock gate of the python package (`make python-lock-check`; docs/plans/fsm-v1.md, C-1; docs/plans/execution-checklist.md,
// S-34). The kit dependency gate reads only the build-system and optional requirements of a Python manifest, so a runtime
// dependency of pyproject.toml without a pin passes it. This gate reads the uv.lock beside the manifest, offline, and checks:
//
//   lock     the lock exists and is a uv lock of version 1
//   pin      every registry package has an exact version, at least one artifact, and a sha256 hash on every artifact;
//            a requirement pinned with == in pyproject.toml names the locked version
//   commit   every git package names a 40-character commit after '#' in its source
//   tag      a git requirement of pyproject.toml names the tag that the lock records (rev=) for the same package
//   current  the dependencies of the project in the lock are the requirements of pyproject.toml
//   closure  every dependency of a locked package is itself locked
//   export   the committed pylock.toml (PEP 751) has the body of a fresh `uv export --format pylock.toml --frozen
//            --no-emit-project` of uv.lock (S-34-2). The header comment names the command and its flags, so it is not compared.
//
//   node scripts/check-python-lock.mjs [<package directory>]
//
// The directory defaults to packages/fsm-python of this checkout. A finding is { rule, subject, problem, fix }; the command
// prints one line per finding and exits 1 when there is one. The export rule runs uv (no network: --frozen).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RULES = {
  lock: 'the package directory has a pyproject.toml and a uv.lock of version 1',
  pin: 'every registry package is locked at an exact version with an artifact and a sha256 hash on each artifact, and at the version that pyproject.toml pins',
  commit: 'every git package is locked at a 40-character commit',
  tag: 'a git requirement of pyproject.toml is locked at the tag it names',
  current: 'the requirements of pyproject.toml are the dependencies of the project in uv.lock',
  closure: 'every dependency of a locked package is locked',
  export: 'the committed pylock.toml has the body of a fresh uv export of uv.lock (--format pylock.toml --frozen --no-emit-project)',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIRECTORY = path.join(ROOT, 'packages/fsm-python');
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /#([0-9a-f]{40})$/;

/** A PEP 503 name: lower case, runs of - _ . as one -. */
export const normalize = name => name.toLowerCase().replace(/[-_.]+/g, '-');

/** The requirements of the [project] table of a pyproject.toml: { name, pin, tag } for each quoted requirement. */
export function requirements(text) {
  const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
  const list = project && /^dependencies\s*=\s*\[([\s\S]*?)^\]/m.exec(project[1]);
  if (!list) return [];
  return [...list[1].matchAll(/"([^"]+)"/g)].map(([, item]) => {
    const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(item)[1];
    const pin = /^[^@=<>~!;\s]+\s*==\s*([^\s;,]+)\s*$/.exec(item.trim());
    const url = /^[^@]+@\s*(.+)$/.exec(item.trim());
    const tag = url && /git\+[^"]*?@([^@#/\s]+)(?=#|$)/.exec(url[1]);
    return { name, pin: pin ? pin[1] : null, tag: tag ? tag[1] : null };
  });
}

/** The packages of a uv.lock: { name, version, source, sources, dependencies, hashes, urls, rev, commit } per [[package]] block. */
export function packages(text) {
  return text.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => {
    const body = block.split(/^\[package\.metadata\]\s*$|^\[package\.optional-dependencies\]\s*$/m)[0];
    const top = key => {
      const match = new RegExp(`^${key} = "([^"]*)"`, 'm').exec(body);
      return match ? match[1] : null;
    };
    const source = /^source = \{ ([a-z]+) = "([^"]*)"/m.exec(body);
    const dependencies = [...(/^dependencies = \[([\s\S]*?)^\]|^dependencies = \[\]/m.exec(body)?.[1] ?? '').matchAll(/\{ name = "([^"]+)"/g)].map(([, name]) => name);
    const hashes = [...body.matchAll(/hash = "([^"]*)"/g)].map(([, hash]) => hash);
    const urls = [...body.matchAll(/url = "[^"]*"/g)].length;
    const rev = source && source[1] === 'git' ? /[?&]rev=([^&#"]+)/.exec(source[2]) : null;
    return {
      name: top('name'),
      version: top('version'),
      source: source ? source[1] : null,
      sourceValue: source ? source[2] : null,
      dependencies,
      hashes,
      urls,
      rev: rev ? rev[1] : null,
    };
  });
}

/** The findings of the package directory `directory`, an absolute path or one relative to the working directory. */
export function check(directory = DEFAULT_DIRECTORY) {
  const findings = [];
  const add = (rule, subject, problem, fix) => findings.push({ rule, subject, problem, fix });
  const manifestPath = path.join(directory, 'pyproject.toml');
  const lockPath = path.join(directory, 'uv.lock');
  const relative = path.relative(ROOT, directory) || '.';
  const manifest = `${relative}/pyproject.toml`;
  const lock = `${relative}/uv.lock`;
  if (!existsSync(manifestPath)) {
    add('lock', manifest, 'the manifest does not exist', 'name the package directory that holds pyproject.toml');
    return findings;
  }
  if (!existsSync(lockPath)) {
    add('lock', lock, 'the uv lock does not exist', `run uv lock in ${relative}`);
    return findings;
  }
  const lockText = readFileSync(lockPath, 'utf8');
  if (!/^version = 1$/m.test(lockText)) {
    add('lock', lock, 'the file is not a uv lock of version 1', `run uv lock in ${relative}`);
    return findings;
  }
  const pyproject = requirements(readFileSync(manifestPath, 'utf8'));
  const locked = packages(lockText);
  const byName = new Map(locked.map(item => [normalize(item.name ?? ''), item]));
  const project = locked.find(item => item.source === 'editable');

  for (const item of locked) {
    if (item.source === 'editable') continue;
    const subject = `${lock} ${item.name}`;
    if (item.source === 'registry') {
      if (!item.version) add('pin', subject, 'the package has no version', `run uv lock in ${relative}`);
      if (item.urls === 0 || item.hashes.length === 0) add('pin', subject, 'the package has no artifact with a hash', `run uv lock in ${relative}`);
      else if (item.hashes.length !== item.urls) add('pin', subject, `${item.urls} artifacts and ${item.hashes.length} hashes`, `run uv lock in ${relative}`);
      else if (!item.hashes.every(hash => SHA256.test(hash))) add('pin', subject, 'an artifact hash is not a sha256 of 64 hex digits', `run uv lock in ${relative}`);
    } else if (item.source === 'git') {
      if (!item.version) add('pin', subject, 'the package has no version', `run uv lock in ${relative}`);
      if (!COMMIT.test(item.sourceValue ?? '')) add('commit', subject, 'the git source names no 40-character commit after #', `run uv lock in ${relative}`);
    } else {
      add('pin', subject, `the source ${item.source ?? 'is absent'} is not a registry or a git source`, 'lock the package from a registry or a git commit');
    }
    for (const dependency of item.dependencies) {
      if (!byName.has(normalize(dependency))) add('closure', `${subject} ${dependency}`, `the dependency ${dependency} is not locked`, `run uv lock in ${relative}`);
    }
  }

  if (!project) {
    add('current', lock, 'the lock has no editable project entry', `run uv lock in ${relative}`);
  } else {
    const wanted = new Set(pyproject.map(item => normalize(item.name)));
    const have = new Set(project.dependencies.map(normalize));
    for (const name of wanted) if (!have.has(name)) add('current', `${manifest} ${name}`, `the requirement ${name} is not a dependency of the locked project`, `run uv lock in ${relative}`);
    for (const name of have) if (!wanted.has(name)) add('current', `${lock} ${name}`, `the locked project depends on ${name}, pyproject.toml does not require it`, `run uv lock in ${relative}`);
  }

  for (const requirement of pyproject) {
    const subject = `${manifest} ${requirement.name}`;
    const item = byName.get(normalize(requirement.name));
    if (!item) {
      add('current', subject, `the requirement ${requirement.name} is not locked`, `run uv lock in ${relative}`);
      continue;
    }
    if (requirement.pin && item.version !== requirement.pin) add('pin', subject, `pyproject.toml pins ${requirement.pin}, the lock holds ${item.version}`, `run uv lock in ${relative}`);
    if (requirement.tag && item.rev !== requirement.tag) add('tag', subject, `pyproject.toml names the tag ${requirement.tag}, the lock records ${item.rev ?? 'no tag'}`, `run uv lock in ${relative}`);
  }
  return findings;
}

/** The body of a PEP 751 file: its lines without the header comment, with the line ends of the file kept. */
export const pylockBody = text => text.split('\n').filter(line => !line.startsWith('#')).join('\n').replace(/\n+$/, '\n');

/**
 * Runs uv export of the package directory and returns its text: the pylock.toml of uv.lock, in the form the lock gate reads.
 * `--color never` keeps the output free of escape codes; a uv that fails throws with its stderr.
 */
export function uvExport(directory) {
  const result = spawnSync('uv', ['export', '--format', 'pylock.toml', '--frozen', '--no-emit-project', '--color', 'never'], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`uv export could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`uv export failed with exit ${result.status}: ${result.stderr.trim()}`);
  return result.stdout;
}

/**
 * The export rule: pylock.toml of `directory` has the body of `exporter(directory)`, a fresh export of uv.lock. A missing file
 * is a finding, and the exporter may throw (the command reports that and exits 2).
 */
export function checkExport(directory = DEFAULT_DIRECTORY, exporter = uvExport) {
  const relative = path.relative(ROOT, directory) || '.';
  const subject = `${relative}/pylock.toml`;
  const pylockPath = path.join(directory, 'pylock.toml');
  if (!existsSync(pylockPath)) {
    return [{ rule: 'export', subject, problem: 'the file does not exist', fix: `run make -C ${relative} install, which exports it from uv.lock` }];
  }
  const committed = pylockBody(readFileSync(pylockPath, 'utf8'));
  const fresh = pylockBody(exporter(directory));
  if (committed === fresh) return [];
  const line = committed.split('\n').findIndex((text, index) => text !== fresh.split('\n')[index]) + 1;
  return [{
    rule: 'export',
    subject,
    problem: `the body differs from a fresh export of uv.lock at body line ${line}`,
    fix: `run make -C ${relative} install, which exports it from uv.lock, and commit the file`,
  }];
}

/** The line of a finding. */
export const findingLine = finding => `[python-lock] ${finding.subject}: ${finding.problem}. Rule: ${RULES[finding.rule]}. Fix: ${finding.fix}.`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error('Usage: node scripts/check-python-lock.mjs [<package directory>]');
    process.exit(2);
  }
  const directory = args.length ? path.resolve(args[0]) : DEFAULT_DIRECTORY;
  const findings = [...check(directory), ...checkExport(directory)];
  if (findings.length) {
    for (const finding of findings) console.error(findingLine(finding));
    console.error(`[python-lock] ${findings.length} finding${findings.length === 1 ? '' : 's'}; the check reads only the files of the package directory`);
    process.exit(1);
  }
  process.stdout.write(`[python-lock] ${path.relative(ROOT, directory) || '.'}: every package of uv.lock is locked at a version, hashes and commits, matches pyproject.toml, and pylock.toml is its export\n`);
}
