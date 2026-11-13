// The common suite of the legacy tests (conformance.mjs) against the WASM binding of the installed package, its subpath ./wasm
// (binding P-5); make test-wasm-conformance runs it.
import * as fsm from '@polyspec/fsm/wasm';
import { runVectors } from './conformance.mjs';

runVectors(fsm);
