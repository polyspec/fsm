// Package tests holds the conformance tests of the go package (docs/plans/status-v1.md, C-4). Every vector case of vectors_test.go
// (generated from the core oracle) is one subtest named test_<feature>__<id>: it calls the generated functions of src/ and asserts
// the expected value or the error code. The persist cases run the B-4 example (examples/persist.go) on SQLite and assert the
// stored state after the run. The keys of the vectors are mapped to the constants of the order machine by the tables below.
package tests

import (
	"errors"
	"path/filepath"
	"slices"
	"testing"

	"github.com/polyspec/status-go/examples"
	"github.com/polyspec/status-go/src/order"
	"github.com/polyspec/status-go/src/status"
)

// machineVectors and vectorCase are the shape of the data of vectors_test.go. A case keeps the keys of the oracle: state, event,
// expected and actual are keys, input and code are numbers, and want holds the expectation of its feature.
type machineVectors struct {
	machine string
	cases   []vectorCase
}

type vectorCase struct {
	feature  string
	id       string
	state    string
	event    string
	expected string
	actual   string
	stored   string
	scenario string
	input    int64
	code     int64
	want     expectation
}

// expectation holds the expected result of a case: the fields that its feature uses are set.
type expectation struct {
	state       string
	to          string
	error       string
	changed     bool
	storedAfter string
	code        int64
	key         string
	final       bool
	events      []string
}

// The keys of the order machine and the constants that they name (docs/spec/status.md, B-6).
var states = map[string]order.State{
	"draft":    order.StateDraft,
	"paid":     order.StatePaid,
	"shipped":  order.StateShipped,
	"done":     order.StateDone,
	"canceled": order.StateCanceled,
}

var events = map[string]order.Event{
	"next":   order.EventNext,
	"prev":   order.EventPrev,
	"cancel": order.EventCancel,
}

// TestConformance runs every vector case as the subtest test_<feature>__<id> of this test.
func TestConformance(t *testing.T) {
	for _, machine := range vectors {
		if machine.machine != "order" {
			t.Fatalf("no conformance check for the machine %s; this package checks order", machine.machine)
		}
		for _, c := range machine.cases {
			t.Run("test_"+c.feature+"__"+c.id, func(t *testing.T) {
				runCase(t, c)
			})
		}
	}
}

// mustState returns the state of a key; a key that is no state fails the test.
func mustState(t *testing.T, key string) order.State {
	t.Helper()
	state, ok := states[key]
	if !ok {
		t.Fatalf("%q is no state of order", key)
	}
	return state
}

// mustEvent returns the event of a key; a key that is no event fails the test.
func mustEvent(t *testing.T, key string) order.Event {
	t.Helper()
	event, ok := events[key]
	if !ok {
		t.Fatalf("%q is no event of order", key)
	}
	return event
}

// assertCode fails the test unless err is a *status.Error whose code is code.
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	var statusErr *status.Error
	if !errors.As(err, &statusErr) {
		t.Fatalf("want a *status.Error with %s, got %v", code, err)
	}
	if statusErr.Code != code {
		t.Fatalf("want the code %s, got %s (%s)", code, statusErr.Code, statusErr.Message)
	}
}

// assertNoError fails the test when err is not nil.
func assertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// runCase checks one case against the generated functions of its feature.
func runCase(t *testing.T, c vectorCase) {
	switch c.feature {
	case "initial":
		if got := order.Initial(); got != mustState(t, c.want.state) {
			t.Fatalf("Initial() = %d, want %s", got, c.want.state)
		}
	case "code":
		got, err := order.Code(mustState(t, c.state))
		assertNoError(t, err)
		if int64(got) != c.want.code {
			t.Fatalf("Code = %d, want %d", got, c.want.code)
		}
	case "key":
		got, err := order.Key(order.State(c.code))
		assertNoError(t, err)
		if got != c.want.key {
			t.Fatalf("Key = %q, want %q", got, c.want.key)
		}
	case "from_code":
		got, err := order.FromCode(c.input)
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if got != mustState(t, c.want.state) {
			t.Fatalf("FromCode(%d) = %d, want %s", c.input, got, c.want.state)
		}
	case "is_final":
		got, err := order.IsFinal(mustState(t, c.state))
		assertNoError(t, err)
		if got != c.want.final {
			t.Fatalf("IsFinal = %t, want %t", got, c.want.final)
		}
	case "events_from":
		got, err := order.EventsFrom(mustState(t, c.state))
		assertNoError(t, err)
		want := make([]order.Event, 0, len(c.want.events))
		for _, key := range c.want.events {
			want = append(want, mustEvent(t, key))
		}
		if !slices.Equal(got, want) {
			t.Fatalf("EventsFrom = %v, want %v", got, want)
		}
	case "target":
		got, err := order.Target(mustState(t, c.state), mustEvent(t, c.event))
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if got != mustState(t, c.want.state) {
			t.Fatalf("Target = %d, want %s", got, c.want.state)
		}
	case "apply":
		step, err := order.Apply(mustState(t, c.expected), mustEvent(t, c.event), mustState(t, c.actual))
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if step != (order.Step{To: mustState(t, c.want.to), Changed: c.want.changed}) {
			t.Fatalf("Apply = %+v, want to %s changed %t", step, c.want.to, c.want.changed)
		}
	case "persist":
		runPersist(t, c)
	default:
		t.Fatalf("no check for the feature %s; the vectors and this file must agree", c.feature)
	}
}

// runPersist runs one persist case on a new SQLite database: the row 1 holds the stored state, one transition runs, and the stored
// state after the run is asserted.
func runPersist(t *testing.T, c vectorCase) {
	db, err := examples.Open("sqlite://" + filepath.Join(t.TempDir(), "persist.db"))
	assertNoError(t, err)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	})
	assertNoError(t, examples.Seed(db, 1, mustState(t, c.stored)))
	step, err := examples.Transition(db, 1, mustState(t, c.expected), mustEvent(t, c.event))
	if c.want.error != "" {
		assertCode(t, err, c.want.error)
	} else {
		assertNoError(t, err)
		if step != (order.Step{To: mustState(t, c.want.storedAfter), Changed: c.want.changed}) {
			t.Fatalf("Transition = %+v, want to %s changed %t", step, c.want.storedAfter, c.want.changed)
		}
	}
	stored, err := examples.StatusOf(db, 1)
	assertNoError(t, err)
	if stored != mustState(t, c.want.storedAfter) {
		t.Fatalf("the stored state after the run is %d, want %s", stored, c.want.storedAfter)
	}
}
