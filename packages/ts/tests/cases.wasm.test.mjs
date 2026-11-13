// The contract cases of fsm (cases.mjs) against the WASM binding of the installed package, its subpath ./wasm (binding P-5);
// make test-wasm runs it.
import * as fsm from '@polyspec/fsm/wasm';
import { runCases } from './cases.mjs';

runCases(fsm);
