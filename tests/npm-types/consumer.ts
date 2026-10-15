// The consumer of the generated declarations (docs/spec/fsm.md, B-6). tests/npm-types/npm-types.test.mts compiles this file with
// tsc --noEmit --strict: every name of the notation is used, and every @ts-expect-error line must fail to compile, so a
// declaration that is too loose makes an unused directive, which tsc reports as an error. The checked values are
// exports, so the file uses each of them.
import { order, fsm } from '../../packages/js/src/index.js';

// The states and events are typed by their values, and the functions by their signatures.
const draft: order.State = order.State.Draft;
const next: order.Event = order.Event.Next;
export const start: order.State = order.initial();
export const code: number = order.code(draft);
export const key: 'draft' | 'paid' | 'shipped' | 'done' | 'canceled' = order.key(draft);
export const parsed: order.State = order.fromCode(1);
export const final: boolean = order.isFinal(draft);
export const events: order.Event[] = order.eventsFrom(draft);
export const to: order.State = order.target(draft, next);

// The result of apply has the fields to and changed.
const step: order.Step = order.apply(draft, next, draft);
export const reached: order.State = step.to;
export const changed: boolean = step.changed;

// The error of the shared module has its fields, and its codes are the error code constants.
const failure = new fsm.Error(fsm.Code.Conflict, 'the stored state is neither', { expected: 1, actual: 2, event: 1 });
export const failureCode: fsm.ErrorCode = failure.code;
export const expected: number | undefined = failure.expected;
export const actual: number | undefined = failure.actual;
export const event: number | undefined = failure.event;
export const message: string = failure.message;
export const reserved: fsm.ErrorCode = fsm.Code.ReservedCode;

// @ts-expect-error a state is one of the codes of order; 6 is none of them
export const notAState: order.State = 6;

// @ts-expect-error apply takes an event of the machine, not a string
order.apply(draft, 'next', draft);

// @ts-expect-error Step has the fields to and changed only
void step.event;
