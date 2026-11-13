// What the tests of the scripts of the servers share (S-472-1, S-475): a directory of stand-in programs of one case, the only
// programs of its PATH, with a uname that names the platform. A test writes its bay and its container program into it, so it
// needs no container runtime, and a bay, a docker or a container of the machine is never found: the PATH of the script under test is that directory
// alone, and a stand-in sets the PATH of the system for the tools that it runs itself.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/** The stand-ins of one case: their directory, which is the PATH of the script under test, and `program`, which writes an executable `name`: a shell script with the lines `text`. */
export interface StandIns {
  directory: string;
  path: string;
  program: (name: string, text: string) => void;
}

/** Makes the directory of the stand-ins of the case `t`, removed when the case ends, with a uname that prints `system`. */
export function standIns(t: TestContext, system: string): StandIns {
  const directory = mkdtempSync(path.join(tmpdir(), 'fsm-stand-ins-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const program = (name: string, text: string): void => {
    writeFileSync(path.join(directory, name), `#!/bin/sh\nPATH=/usr/bin:/bin\n${text}`);
    chmodSync(path.join(directory, name), 0o755);
  };
  program('uname', `echo ${system}\n`);
  return { directory, path: directory, program };
}
