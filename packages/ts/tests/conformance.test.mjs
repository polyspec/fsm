// The common suite of the legacy tests (conformance.mjs) against the Node binding of the installed package; make
// test-node-conformance runs it.
import * as fsm from '@polyspec/fsm';
import { runVectors } from './conformance.mjs';

runVectors(fsm);
