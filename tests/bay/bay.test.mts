// The installation of scripts/bay.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-475-4, S-475-5):
// `install` downloads the archive of bay that config/toolchain.json pins for the platform, fails unless its sha256 is that
// of the pin, extracts it, installs bay and bayd into /usr/local/bin with sudo -n, applies the machine setup with bay
// install, requires bay check -scope run and fails unless the installed bay prints the pinned version. bay is started by
// the words of the variable BAY.
//
// A test copies the script and the pin into a root of its own and runs it with stand-ins of curl, tar, sudo and bay that it
// writes, the only programs of PATH beside a uname, so it downloads nothing and installs nothing. The copied pin holds the
// sha256 of the archive that the stand-in curl writes, since no test holds the archive of a release.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { standIns } from '../support/stand-ins.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The pin of bay in the config/toolchain.json of `root`. */
function pinOf(root: string): { toolchain: Record<string, unknown>; bay: Record<string, unknown>; sha256: Record<string, unknown> } {
  const toolchain: unknown = JSON.parse(readFileSync(path.join(root, 'config/toolchain.json'), 'utf8'));
  assert.ok(isRecord(toolchain) && isRecord(toolchain.bay) && isRecord(toolchain.bay.sha256), 'config/toolchain.json pins no bay');
  return { toolchain, bay: toolchain.bay, sha256: toolchain.bay.sha256 };
}

const VERSION = String(pinOf(ROOT).bay.version);
// The platform of the test as the pin names it, and the name of the archive of that platform in the release.
const PLATFORM = `${process.platform}-${process.arch}`;
const NAME = `bay_v${VERSION}_${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
const URL = `https://github.com/polyspec/bay/releases/download/v${VERSION}/${NAME}.tar.gz`;
const ARCHIVE = 'the bytes of an archive\n';

test('the pin of bay names a release, a sha256 for each platform, its reason and its removal condition', () => {
  const { bay, sha256 } = pinOf(ROOT);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(sha256).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
  for (const digest of Object.values(sha256)) assert.match(String(digest), /^[0-9a-f]{64}$/);
  for (const key of ['reason', 'removal']) assert.ok(typeof bay[key] === 'string' && bay[key] !== '', `the pin of bay holds no ${key}`);
});

/** The root and the stand-ins of one case. */
interface Stage {
  root: string;
  env: NodeJS.ProcessEnv;
  /** The commands that the stand-ins received, in their order, each as the name of its program and its words. */
  calls: () => string[][];
}

/**
 * Copies the script and the pin into a root of its own and writes the stand-ins. The copied pin holds the sha256 of the
 * archive of the stand-in curl, or another one when `wrong`; the stand-in bay prints the pinned version, or another one
 * when `other`.
 */
function stage(t: TestContext, { wrong = false, other = false } = {}): Stage {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fsm-bay-root-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  for (const file of ['scripts/bay.mts', 'config/toolchain.json']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(ROOT, file), path.join(root, file));
  }
  const { toolchain, sha256 } = pinOf(root);
  sha256[PLATFORM] = createHash('sha256').update(wrong ? 'other bytes\n' : ARCHIVE).digest('hex');
  writeFileSync(path.join(root, 'config/toolchain.json'), `${JSON.stringify(toolchain, null, 2)}\n`);
  const { directory, path: PATH, program: write } = standIns(t, 'Linux');
  writeFileSync(path.join(directory, 'archive'), ARCHIVE);
  // Each command is one line of the file calls, the name of the program and its words joined by a tab.
  const record = (name: string): string => `d='${directory}'
line=${name}
for word in "$@"; do line="$line\t$word"; done
printf '%s\\n' "$line" >> "$d/calls"
`;
  // curl writes the archive to the file of its option -o; tar makes the directory of the archive with its two programs;
  // sudo -n runs its command, and installs nothing for the command install.
  write('curl', `${record('curl')}cp "$d/archive" "$3"\n`);
  write('tar', `${record('tar')}name=$(basename "$2" .tar.gz)\nmkdir -p "$4/$name"\n: > "$4/$name/bay"\n: > "$4/$name/bayd"\n`);
  write('sudo', `${record('sudo')}[ "$1" = -n ] || exit 2\nshift\n[ "$1" = install ] && exit 0\nPATH='${directory}' exec "$@"\n`);
  write('bay', `${record('bay')}case "$1" in
version) echo '{"version":"v${other ? '9.9.9' : VERSION}","schemaVersion":1}' ;;
install | check) ;;
*) exit 2 ;;
esac
`);
  return {
    root,
    env: { PATH, BAY: 'sudo -n bay' },
    calls: () => (existsSync(path.join(directory, 'calls')) ? readFileSync(path.join(directory, 'calls'), 'utf8') : '').split('\n').filter(line => line !== '').map(line => line.split('\t')),
  };
}

/** Runs `scripts/bay.mts` of `staged` with `args`. */
function script(staged: Stage, args: string[]) {
  return spawnSync(process.execPath, [path.join(staged.root, 'scripts/bay.mts'), ...args], { encoding: 'utf8', env: staged.env });
}

test('install downloads the pinned archive, verifies its sha256, installs bay and bayd with sudo -n, applies the setup and requires the pinned version', t => {
  const staged = stage(t);
  const ran = script(staged, ['install']);
  assert.equal(ran.status, 0, ran.stderr);
  const directory = path.join(staged.root, 'var/tools/bay');
  const archive = path.join(directory, `${NAME}.tar.gz`);
  // Each command of bay runs through the words of BAY, so one user runs them all.
  const started = (words: string[]): string[][] => [['sudo', '-n', 'bay', ...words], ['bay', ...words]];
  assert.deepEqual(staged.calls(), [
    ['curl', '-fsSL', '-o', archive, URL],
    ['tar', '-xzf', archive, '-C', directory],
    ['sudo', '-n', 'install', '-m', '755', path.join(directory, NAME, 'bay'), path.join(directory, NAME, 'bayd'), '/usr/local/bin/'],
    ...started(['install']),
    ...started(['check', '-scope', 'run']),
    ...started(['version', '--json']),
  ]);
});

test('an archive whose sha256 is not that of the pin fails the installation before anything is extracted or installed', t => {
  const staged = stage(t, { wrong: true });
  const ran = script(staged, ['install']);
  assert.equal(ran.status, 1);
  const archive = path.join(staged.root, 'var/tools/bay', `${NAME}.tar.gz`);
  assert.match(ran.stderr, new RegExp(`^scripts/bay\\.mts: the sha256 of ${archive.replaceAll('.', '\\.')} is [0-9a-f]{64}, and config/toolchain\\.json pins [0-9a-f]{64} for ${PLATFORM}$`, 'm'));
  assert.deepEqual(staged.calls(), [['curl', '-fsSL', '-o', archive, URL]]);
  assert.equal(existsSync(archive), false, 'the archive that failed its digest stays');
});

test('an installed bay that prints another version than the pin fails the installation and names the pinned release', t => {
  const staged = stage(t, { other: true });
  const ran = script(staged, ['install']);
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, new RegExp(`^scripts/bay\\.mts: bay is v9\\.9\\.9, and config/toolchain\\.json pins v${VERSION.replaceAll('.', '\\.')}: install the release https://github\\.com/polyspec/bay/releases/tag/v${VERSION.replaceAll('.', '\\.')}$`, 'm'));
});

test('a verb that the script does not know fails with the usage', t => {
  for (const args of [[], ['install', 'now'], ['pull']]) {
    const staged = stage(t);
    const ran = script(staged, args);
    assert.equal(ran.status, 2, args.join(' '));
    assert.match(ran.stderr, /^usage: scripts\/bay\.mts install$/m);
    assert.deepEqual(staged.calls(), []);
  }
});
