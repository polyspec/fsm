package tests

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/polyspec/fsm/packages/go/src/in_review"
	"github.com/polyspec/fsm/packages/go/src/limits"
	"github.com/polyspec/fsm/packages/go/src/order"
	"github.com/polyspec/fsm/packages/go/src/standby"
	"github.com/polyspec/fsm/packages/go/src/ticket"
)

// vectorsFile is the vector file of the oracle, contracts/conformance/vectors.json: the nearest parent folder of the test that holds
// it names it.
func vectorsFile() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(directory, "contracts", "conformance", "vectors.json")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", fmt.Errorf("no parent folder of the test holds contracts/conformance/vectors.json")
		}
		directory = parent
	}
}

// jsonCase is a case as the vector file writes it. A field that a feature does not use is absent, and expect is the expectation
// of the feature: a value, a list or an object (an error is an object with a code in error).
type jsonCase struct {
	Feature       string          `json:"feature"`
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	State         string          `json:"state"`
	Event         string          `json:"event"`
	Expected      string          `json:"expected"`
	Actual        string          `json:"actual"`
	Stored        string          `json:"stored"`
	Scenario      string          `json:"scenario"`
	Value         *int64          `json:"value"`
	ExpectedValue *int64          `json:"expected_value"`
	ActualValue   *int64          `json:"actual_value"`
	Input         *string         `json:"input"`
	InputType     string          `json:"input_type"`
	Code          int64           `json:"code"`
	Expect        json.RawMessage `json:"expect"`
}

// jsonExpect is the object form of an expectation: a state, a step, a stored state or an error with the fields of fsm.Error.
type jsonExpect struct {
	State       string `json:"state"`
	To          string `json:"to"`
	Changed     bool   `json:"changed"`
	StoredAfter string `json:"stored_after"`
	Error       string `json:"error"`
	Expected    *int32 `json:"expected"`
	Actual      *int32 `json:"actual"`
	Event       *int32 `json:"event"`
}

// inputOf is the input of a from_code case as the go kind decodes it (docs/spec/fsm.md, B-6): the oracle gives it as a decimal
// string, which is the int it names, a float64, a string or a bool by the input_type of the case.
func inputOf(c jsonCase) (any, error) {
	if c.Input == nil {
		return nil, nil
	}
	switch c.InputType {
	case "":
		number, err := strconv.ParseInt(*c.Input, 10, 64)
		return int(number), err
	case "float":
		return strconv.ParseFloat(*c.Input, 64)
	case "string":
		return *c.Input, nil
	case "bool":
		return strconv.ParseBool(*c.Input)
	}
	return nil, fmt.Errorf("the input type %q of %s is not known", c.InputType, c.ID)
}

// wantOf is the expectation of a case: the object form for an error, a step, a state or a stored state, else the value or the list
// of its feature.
func wantOf(c jsonCase) (expectation, error) {
	var want expectation
	if len(c.Expect) > 0 && c.Expect[0] == '{' {
		var object jsonExpect
		if err := json.Unmarshal(c.Expect, &object); err != nil {
			return want, err
		}
		want = expectation{state: object.State, to: object.To, changed: object.Changed, storedAfter: object.StoredAfter, error: object.Error}
		if object.Expected != nil {
			want.expected = *object.Expected
		}
		if object.Actual != nil {
			want.actual = *object.Actual
		}
		if object.Event != nil {
			want.event = *object.Event
		}
		return want, nil
	}
	switch c.Feature {
	case "code":
		return want, json.Unmarshal(c.Expect, &want.code)
	case "key":
		return want, json.Unmarshal(c.Expect, &want.key)
	case "is_final":
		return want, json.Unmarshal(c.Expect, &want.final)
	case "events_from":
		return want, json.Unmarshal(c.Expect, &want.events)
	}
	return want, fmt.Errorf("the expectation of %s is not an object", c.ID)
}

// vectorOf is a case of the vector file in the shape that runCase checks.
func vectorOf(c jsonCase) (vectorCase, error) {
	input, err := inputOf(c)
	if err != nil {
		return vectorCase{}, err
	}
	want, err := wantOf(c)
	if err != nil {
		return vectorCase{}, err
	}
	out := vectorCase{
		feature: c.Feature, id: c.ID, name: c.Name, state: c.State, event: c.Event, expected: c.Expected, actual: c.Actual,
		stored: c.Stored, scenario: c.Scenario, input: input, code: c.Code, want: want,
	}
	if c.Value != nil {
		out.value, out.hasValue = *c.Value, true
	}
	if c.ExpectedValue != nil {
		out.expectedValue, out.expectedIsValue = *c.ExpectedValue, true
	}
	if c.ActualValue != nil {
		out.actualValue, out.actualIsValue = *c.ActualValue, true
	}
	return out, nil
}

// loadVectors reads the vector file when the test runs and fails the test when it cannot.
func loadVectors(t *testing.T) []machineVectors {
	t.Helper()
	file, err := vectorsFile()
	if err != nil {
		t.Fatal(err)
	}
	text, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Machines []struct {
			Machine string     `json:"machine"`
			Cases   []jsonCase `json:"cases"`
		} `json:"machines"`
	}
	if err := json.Unmarshal(text, &document); err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	var out []machineVectors
	for _, entry := range document.Machines {
		machine := machineVectors{machine: entry.Machine}
		for _, c := range entry.Cases {
			converted, err := vectorOf(c)
			if err != nil {
				t.Fatalf("%s: %v", c.ID, err)
			}
			machine.cases = append(machine.cases, converted)
		}
		out = append(out, machine)
	}
	return out
}

// machine is the adapter of one machine package: its functions and its constants by key (docs/spec/fsm.md, B-6). It takes keys
// (and the integers of the state arguments that carry a value) and returns keys; it returns the errors of the functions unchanged.
type machine[S, E ~int32] struct {
	initialState func() S
	codeOf       func(S) (int32, error)
	keyOf        func(S) (string, error)
	fromCodeOf   func(any) (S, error)
	isFinalOf    func(S) (bool, error)
	eventsFromOf func(S) ([]E, error)
	targetOf     func(S, E) (S, error)
	applyOf      func(S, E, S) (S, bool, error)
	states       map[string]S
	events       map[string]E
}

func (m machine[S, E]) initial() (string, error) {
	return m.keyOf(m.initialState())
}

// state returns the state of a key, or, for a raw code, the state that from_code gives it: an invalid code is rejected there.
func (m machine[S, E]) state(arg stateArg) (S, error) {
	if arg.isValue {
		return m.fromCodeOf(arg.value)
	}
	return lookup(m.states, "state", arg.key)
}

func (m machine[S, E]) code(state stateArg) (int32, error) {
	value, err := m.state(state)
	if err != nil {
		return 0, err
	}
	return m.codeOf(value)
}

func (m machine[S, E]) key(code int64) (string, error) {
	value, err := m.fromCodeOf(code)
	if err != nil {
		return "", err
	}
	return m.keyOf(value)
}

func (m machine[S, E]) fromCode(code any) (string, error) {
	value, err := m.fromCodeOf(code)
	if err != nil {
		return "", err
	}
	return m.keyOf(value)
}

func (m machine[S, E]) isFinal(state stateArg) (bool, error) {
	value, err := m.state(state)
	if err != nil {
		return false, err
	}
	return m.isFinalOf(value)
}

func (m machine[S, E]) eventsFrom(state string) ([]string, error) {
	value, err := lookup(m.states, "state", state)
	if err != nil {
		return nil, err
	}
	events, err := m.eventsFromOf(value)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(events))
	for _, event := range events {
		key, err := keyOf(m.events, "event", event)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, nil
}

func (m machine[S, E]) target(expected, event string) (string, error) {
	from, err := lookup(m.states, "state", expected)
	if err != nil {
		return "", err
	}
	value, err := lookup(m.events, "event", event)
	if err != nil {
		return "", err
	}
	to, err := m.targetOf(from, value)
	if err != nil {
		return "", err
	}
	return keyOf(m.states, "state", to)
}

func (m machine[S, E]) apply(expected stateArg, event string, actual stateArg) (string, bool, error) {
	from, err := m.state(expected)
	if err != nil {
		return "", false, err
	}
	value, err := lookup(m.events, "event", event)
	if err != nil {
		return "", false, err
	}
	observed, err := m.state(actual)
	if err != nil {
		return "", false, err
	}
	to, changed, err := m.applyOf(from, value, observed)
	if err != nil {
		return "", false, err
	}
	key, err := keyOf(m.states, "state", to)
	return key, changed, err
}

func (m machine[S, E]) decide(expected, event string) func(stored int64) (int32, bool, error) {
	return func(stored int64) (int32, bool, error) {
		from, err := lookup(m.states, "state", expected)
		if err != nil {
			return 0, false, err
		}
		value, err := lookup(m.events, "event", event)
		if err != nil {
			return 0, false, err
		}
		observed, err := m.fromCodeOf(stored)
		if err != nil {
			return 0, false, err
		}
		to, changed, err := m.applyOf(from, value, observed)
		if err != nil {
			return 0, false, err
		}
		code, err := m.codeOf(to)
		return code, changed, err
	}
}

// machines maps the key of each machine of the vector file to its adapter; the conformance test runs the cases of a machine
// through it, and fails when the vector file names a machine that is not here.
var machines = map[string]machineUnderTest{
	"in_review": machine[in_review.State, in_review.Event]{
		initialState: in_review.Initial, codeOf: in_review.Code, keyOf: in_review.Key, fromCodeOf: in_review.FromCode,
		isFinalOf: in_review.IsFinal, eventsFromOf: in_review.EventsFrom, targetOf: in_review.Target,
		applyOf: func(expected in_review.State, event in_review.Event, actual in_review.State) (in_review.State, bool, error) {
			step, err := in_review.Apply(expected, event, actual)
			return step.To, step.Changed, err
		},
		states: map[string]in_review.State{
			"to_do": in_review.StateToDo, "in_progress": in_review.StateInProgress, "done_now": in_review.StateDoneNow,
		},
		events: map[string]in_review.Event{
			"start_work": in_review.EventStartWork, "finish_work": in_review.EventFinishWork, "reopen_work": in_review.EventReopenWork,
		},
	},
	"limits": machine[limits.State, limits.Event]{
		initialState: limits.Initial, codeOf: limits.Code, keyOf: limits.Key, fromCodeOf: limits.FromCode,
		isFinalOf: limits.IsFinal, eventsFromOf: limits.EventsFrom, targetOf: limits.Target,
		applyOf: func(expected limits.State, event limits.Event, actual limits.State) (limits.State, bool, error) {
			step, err := limits.Apply(expected, event, actual)
			return step.To, step.Changed, err
		},
		states: map[string]limits.State{"floor": limits.StateFloor, "ceiling": limits.StateCeiling},
		events: map[string]limits.Event{"rise": limits.EventRise},
	},
	"order": machine[order.State, order.Event]{
		initialState: order.Initial, codeOf: order.Code, keyOf: order.Key, fromCodeOf: order.FromCode,
		isFinalOf: order.IsFinal, eventsFromOf: order.EventsFrom, targetOf: order.Target,
		applyOf: func(expected order.State, event order.Event, actual order.State) (order.State, bool, error) {
			step, err := order.Apply(expected, event, actual)
			return step.To, step.Changed, err
		},
		states: map[string]order.State{
			"draft": order.StateDraft, "paid": order.StatePaid, "shipped": order.StateShipped, "done": order.StateDone,
			"canceled": order.StateCanceled,
		},
		events: map[string]order.Event{"next": order.EventNext, "prev": order.EventPrev, "cancel": order.EventCancel},
	},
	"standby": machine[standby.State, standby.Event]{
		initialState: standby.Initial, codeOf: standby.Code, keyOf: standby.Key, fromCodeOf: standby.FromCode,
		isFinalOf: standby.IsFinal, eventsFromOf: standby.EventsFrom, targetOf: standby.Target,
		applyOf: func(expected standby.State, event standby.Event, actual standby.State) (standby.State, bool, error) {
			step, err := standby.Apply(expected, event, actual)
			return step.To, step.Changed, err
		},
		states: map[string]standby.State{"ready": standby.StateReady},
		events: map[string]standby.Event{},
	},
	"ticket": machine[ticket.State, ticket.Event]{
		initialState: ticket.Initial, codeOf: ticket.Code, keyOf: ticket.Key, fromCodeOf: ticket.FromCode,
		isFinalOf: ticket.IsFinal, eventsFromOf: ticket.EventsFrom, targetOf: ticket.Target,
		applyOf: func(expected ticket.State, event ticket.Event, actual ticket.State) (ticket.State, bool, error) {
			step, err := ticket.Apply(expected, event, actual)
			return step.To, step.Changed, err
		},
		states: map[string]ticket.State{"open": ticket.StateOpen, "review": ticket.StateReview, "closed": ticket.StateClosed},
		events: map[string]ticket.Event{"submit": ticket.EventSubmit, "approve": ticket.EventApprove, "reject": ticket.EventReject},
	},
}
