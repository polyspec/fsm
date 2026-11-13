// Writes legacy/packages/php-ext/src/<stub>_arginfo.h, the arginfo header of the one stub of the PHP extension, from the stub that fsm-gen writes
// (S-379). The header comes from the gen_stub.php that phpize copies from the build directory of the PHP of the checkout (var/tools/bin).
// phpize runs in a copy of src/ under var/, which the script removes, so the checkout gains only the header. gen_stub.php fetches its
// pinned PHP-Parser into that copy, so the script needs the network.
//
// Usage: node scripts/php-ext-arginfo.mts
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'legacy/packages/php-ext/src');
const work = path.join(root, 'var/php-ext-arginfo', String(process.pid));
const source = path.join(work, 'src');
const tool = (name: string): string => path.join(root, 'var/tools/bin', name);

function run(program: string, args: readonly string[]): void {
  console.log(`[php-ext-arginfo] ${program} ${args.join(' ')}`);
  const result = spawnSync(program, args, { cwd: source, stdio: 'inherit' });
  if (result.error) throw new Error(`${program} did not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
}

try {
  const stubs = readdirSync(extension).filter(name => name.endsWith('.stub.php'));
  const [stub] = stubs;
  if (stubs.length !== 1 || stub === undefined) throw new Error(`legacy/packages/php-ext/src must hold one stub, found ${stubs.length}`);
  const header = `${stub.slice(0, -'.stub.php'.length)}_arginfo.h`;
  mkdirSync(work, { recursive: true });
  cpSync(extension, source, { recursive: true });
  run(tool('phpize'), []);
  run(tool('php'), [path.join(source, 'build/gen_stub.php'), path.join(source, stub)]);
  copyFileSync(path.join(source, header), path.join(extension, header));
  console.log(`[php-ext-arginfo] wrote legacy/packages/php-ext/src/${header}`);
} catch (error) {
  console.error(`php-ext-arginfo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
