// Package tests holds the conformance tests of the go package (docs/plans/fsm-v1.md, C-4). Every vector case of vectors_test.go
// (generated from the core oracle) is one subtest named test_<feature>__<id>. The case is run through the adapter of its machine
// in vectors_test.go, which maps the keys of the oracle to the constants of the machine and calls its generated functions. The
// persist cases run the B-4 example (examples/persist.go) on SQLite and assert the stored code after the run.
package tests

import (
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"testing"

	"github.com/polyspec/fsm-go/examples"
	"github.com/polyspec/fsm-go/src/fsm"
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

// machineUnderTest is the adapter of one machine, generated into vectors_test.go. It takes and returns keys, and returns the errors
// of the generated functions unchanged.
type machineUnderTest interface {
	initial() (string, error)
	code(state string) (int32, error)
	key(code int64) (string, error)
	fromCode(code int64) (string, error)
	isFinal(state string) (bool, error)
	eventsFrom(state string) ([]string, error)
	target(expected, event string) (string, error)
	apply(expected, event, actual string) (string, bool, error)
	decide(expected, event string) examples.Decide
}

// TestConformance runs every vector case as the subtest test_<feature>__<id> of this test, through the adapter of its machine.
func TestConformance(t *testing.T) {
	for _, machine := range vectors {
		adapter, ok := machines[machine.machine]
		if !ok {
			t.Fatalf("no adapter for the machine %s; vectors_test.go must hold one", machine.machine)
		}
		for _, c := range machine.cases {
			t.Run("test_"+c.feature+"__"+c.id, func(t *testing.T) {
				runCase(t, adapter, c)
			})
		}
	}
}

// int32Of returns a code as the 32-bit value of the state types; a value outside the 32-bit range is an error.
func int32Of(code int64) (int32, error) {
	if code != int64(int32(code)) {
		return 0, fmt.Errorf("%d is outside the 32-bit range of the states", code)
	}
	return int32(code), nil
}

// lookup returns the constant of a key of the machine; a key that the machine does not have is an error.
func lookup[T any](table map[string]T, what, key string) (T, error) {
	value, ok := table[key]
	if !ok {
		var zero T
		return zero, fmt.Errorf("%q is no %s of the machine", key, what)
	}
	return value, nil
}

// keyOf returns the key of a constant of the machine; a constant that no key names is an error.
func keyOf[T comparable](table map[string]T, what string, value T) (string, error) {
	for key, candidate := range table {
		if candidate == value {
			return key, nil
		}
	}
	return "", fmt.Errorf("the %s %v has no key in the machine", what, value)
}

// assertCode fails the test unless err is a *fsm.Error whose code is code.
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	var fsmErr *fsm.Error
	if !errors.As(err, &fsmErr) {
		t.Fatalf("want a *fsm.Error with %s, got %v", code, err)
	}
	if fsmErr.Code != code {
		t.Fatalf("want the code %s, got %s (%s)", code, fsmErr.Code, fsmErr.Message)
	}
}

// assertNoError fails the test when err is not nil.
func assertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// runCase checks one case against the generated functions of its feature, through the adapter of its machine.
func runCase(t *testing.T, m machineUnderTest, c vectorCase) {
	switch c.feature {
	case "initial":
		got, err := m.initial()
		assertNoError(t, err)
		if got != c.want.state {
			t.Fatalf("Initial = %q, want %q", got, c.want.state)
		}
	case "code":
		got, err := m.code(c.state)
		assertNoError(t, err)
		if int64(got) != c.want.code {
			t.Fatalf("Code = %d, want %d", got, c.want.code)
		}
	case "key":
		got, err := m.key(c.code)
		assertNoError(t, err)
		if got != c.want.key {
			t.Fatalf("Key = %q, want %q", got, c.want.key)
		}
	case "from_code":
		got, err := m.fromCode(c.input)
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if got != c.want.state {
			t.Fatalf("FromCode(%d) = %q, want %q", c.input, got, c.want.state)
		}
	case "is_final":
		got, err := m.isFinal(c.state)
		assertNoError(t, err)
		if got != c.want.final {
			t.Fatalf("IsFinal = %t, want %t", got, c.want.final)
		}
	case "events_from":
		got, err := m.eventsFrom(c.state)
		assertNoError(t, err)
		if !slices.Equal(got, c.want.events) {
			t.Fatalf("EventsFrom = %v, want %v", got, c.want.events)
		}
	case "target":
		got, err := m.target(c.state, c.event)
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if got != c.want.state {
			t.Fatalf("Target = %q, want %q", got, c.want.state)
		}
	case "apply":
		to, changed, err := m.apply(c.expected, c.event, c.actual)
		if c.want.error != "" {
			assertCode(t, err, c.want.error)
			return
		}
		assertNoError(t, err)
		if to != c.want.to || changed != c.want.changed {
			t.Fatalf("Apply = to %q changed %t, want to %q changed %t", to, changed, c.want.to, c.want.changed)
		}
	case "persist":
		runPersist(t, m, c)
	default:
		t.Fatalf("no check for the feature %s; the vectors and this file must agree", c.feature)
	}
}

// runPersist runs one persist case on a new SQLite database: the row 1 holds the stored code, one transition runs, and the stored
// code after the run is asserted.
func runPersist(t *testing.T, m machineUnderTest, c vectorCase) {
	db, err := examples.Open("sqlite://" + filepath.Join(t.TempDir(), "persist.db"))
	assertNoError(t, err)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	})
	stored, err := m.code(c.stored)
	assertNoError(t, err)
	assertNoError(t, examples.Seed(db, 1, stored))
	to, changed, err := examples.Transition(db, 1, m.decide(c.expected, c.event))
	if c.want.error != "" {
		assertCode(t, err, c.want.error)
	} else {
		assertNoError(t, err)
		want, err := m.code(c.want.storedAfter)
		assertNoError(t, err)
		if to != want || changed != c.want.changed {
			t.Fatalf("Transition = to %d changed %t, want to %d changed %t", to, changed, want, c.want.changed)
		}
	}
	got, err := examples.StatusOf(db, 1)
	assertNoError(t, err)
	want, err := m.code(c.want.storedAfter)
	assertNoError(t, err)
	if got != want {
		t.Fatalf("the stored code after the run is %d, want %d", got, want)
	}
}
