// The contract cases of fsm (cases.mjs) against the Node binding of the installed package; make test-node runs it.
import * as fsm from '@polyspec/fsm';
import { runCases } from './cases.mjs';

runCases(fsm);
