// The consumer of the generated declarations (docs/spec/status.md, B-6). tests/types.test.mjs compiles this file with
// tsc --noEmit --strict: every name of the notation is used, and every @ts-expect-error line must fail to compile, so a
// declaration that is too loose makes an unused directive, which tsc reports as an error.
import { order, status } from '../../src/index.js';

// The states and events are typed by their values, and the functions by their signatures.
const draft: order.State = order.State.Draft;
const next: order.Event = order.Event.Next;
const start: order.State = order.initial();
const code: number = order.code(draft);
const key: 'draft' | 'paid' | 'shipped' | 'done' | 'canceled' = order.key(draft);
const parsed: order.State = order.fromCode(1);
const final: boolean = order.isFinal(draft);
const events: order.Event[] = order.eventsFrom(draft);
const to: order.State = order.target(draft, next);

// The result of apply has the fields to and changed.
const step: order.Step = order.apply(draft, next, draft);
const reached: order.State = step.to;
const changed: boolean = step.changed;

// The error of the shared module has its fields, and its codes are the error code constants.
const failure = new status.Error(status.Code.Conflict, 'the stored state is neither', { expected: 1, actual: 2, event: 1 });
const failureCode: status.ErrorCode = failure.code;
const expected: number | undefined = failure.expected;
const actual: number | undefined = failure.actual;
const event: number | undefined = failure.event;
const message: string = failure.message;
const reserved: status.ErrorCode = status.Code.ReservedCode;

// @ts-expect-error a state is one of the codes of order; 6 is none of them
const notAState: order.State = 6;

// @ts-expect-error apply takes an event of the machine, not a string
order.apply(draft, 'next', draft);

// @ts-expect-error Step has the fields to and changed only
const noSuchField: number = step.event;
