// Package tests holds the conformance tests of the go package (docs/plans/fsm-v1/plan.md, C-4). Every vector case of
// contracts/conformance/vectors.json (written from the core oracle), which vectors_test.go reads when the test runs, is one subtest
// named <feature>__<id>. The case is run through the adapter of its machine in vectors_test.go, which maps the keys of the oracle
// to the constants of the machine and calls its generated functions. The
// persist cases run the B-4 example (examples/persist.go) on the dialect of FSM_TEST_DIALECT and assert the stored code after the
// run (docs/plans/fsm-v1/plan.md, C-6).
package tests

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/polyspec/fsm/packages/go/examples"
	"github.com/polyspec/fsm/packages/go/examples/model"
	"github.com/polyspec/fsm/packages/go/src/fsm"
	"github.com/polyspec/orm/packages/go/orm"
)

// machineVectors and vectorCase are the shape of the vectors of contracts/conformance/vectors.json after loadVectors decodes them.
// A case keeps the keys of the oracle: state, event, expected and actual are keys, input and code are numbers, and want holds the
// expectation of its feature.
type machineVectors struct {
	machine string
	cases   []vectorCase
}

type vectorCase struct {
	feature string
	id      string
	// name is the case name, <feature>__<id>, the name of the subtest.
	name  string
	state string
	event string
	// expected and actual are keys; an invalid state value is given as its integer, with the flag that says so.
	expected        string
	actual          string
	stored          string
	scenario        string
	value           int64
	hasValue        bool
	expectedValue   int64
	expectedIsValue bool
	actualValue     int64
	actualIsValue   bool
	input           any
	code            int64
	want            expectation
}

// expectation holds the expected result of a case: the fields that its feature uses are set. For an error, expected, actual and
// event are the fields of fsm.Error (docs/spec/fsm.md, B-6); zero means the field does not apply, as the null of the vectors.
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
	expected    int32
	actual      int32
	event       int32
}

// stateArg is a state argument of a case: a key, or the integer of a value that the state type holds (an invalid one included).
type stateArg struct {
	key     string
	value   int64
	isValue bool
}

// keyArg is the argument of a key, and valueArg the argument of an integer.
func keyArg(key string) stateArg { return stateArg{key: key} }

func valueArg(value int64) stateArg { return stateArg{value: value, isValue: true} }

// machineUnderTest is the adapter of one machine, generated into vectors_test.go. It takes keys (and the integers of the state
// arguments that carry a value), and returns keys; it returns the errors of the generated functions unchanged.
type machineUnderTest interface {
	initial() (string, error)
	code(state stateArg) (int32, error)
	key(code int64) (string, error)
	fromCode(code any) (string, error)
	isFinal(state stateArg) (bool, error)
	eventsFrom(state string) ([]string, error)
	target(expected, event string) (string, error)
	apply(expected stateArg, event string, actual stateArg) (string, bool, error)
	decide(expected, event string) func(stored int64) (int32, bool, error)
}

// TestConformance runs every vector case as the subtest test_<feature>__<id> of this test, through the adapter of its machine.
// FSM-B4-5: every apply case of the vector file gives the result of the B-4 table.
func TestConformance(t *testing.T) {
	for _, machine := range loadVectors(t) {
		adapter, ok := machines[machine.machine]
		if !ok {
			t.Fatalf("no adapter for the machine %s; vectors_test.go must hold one", machine.machine)
		}
		for _, c := range machine.cases {
			t.Run(c.name, func(t *testing.T) {
				runCase(t, adapter, c)
			})
		}
	}
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

// assertError fails the test unless err is a *fsm.Error with the code and the fields of want (docs/spec/fsm.md, B-4 and B-6).
func assertError(t *testing.T, err error, want expectation) {
	t.Helper()
	var fsmErr *fsm.Error
	if !errors.As(err, &fsmErr) {
		t.Fatalf("want a *fsm.Error with %s, got %v", want.error, err)
	}
	if fsmErr.Code != want.error {
		t.Fatalf("want the code %s, got %s (%s)", want.error, fsmErr.Code, fsmErr.Message)
	}
	if fsmErr.Expected != want.expected || fsmErr.Actual != want.actual || fsmErr.Event != want.event {
		t.Fatalf("%s: want expected %d actual %d event %d, got %d %d %d (%s)", want.error, want.expected, want.actual, want.event,
			fsmErr.Expected, fsmErr.Actual, fsmErr.Event, fsmErr.Message)
	}
}

// assertNoError fails the test when err is not nil.
func assertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// argOf is the argument of a case: its integer when the case gives one, its key otherwise.
func argOf(key string, value int64, isValue bool) stateArg {
	if isValue {
		return valueArg(value)
	}
	return keyArg(key)
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
		got, err := m.code(argOf(c.state, c.value, c.hasValue))
		if c.want.error != "" {
			assertError(t, err, c.want)
			return
		}
		assertNoError(t, err)
		if int64(got) != c.want.code {
			t.Fatalf("Code = %d, want %d", got, c.want.code)
		}
	case "key":
		got, err := m.key(c.code)
		if c.want.error != "" {
			assertError(t, err, c.want)
			return
		}
		assertNoError(t, err)
		if got != c.want.key {
			t.Fatalf("Key = %q, want %q", got, c.want.key)
		}
	case "from_code":
		got, err := m.fromCode(c.input)
		if c.want.error != "" {
			assertError(t, err, c.want)
			return
		}
		assertNoError(t, err)
		if got != c.want.state {
			t.Fatalf("FromCode(%v) = %q, want %q", c.input, got, c.want.state)
		}
	case "is_final":
		got, err := m.isFinal(argOf(c.state, c.value, c.hasValue))
		if c.want.error != "" {
			assertError(t, err, c.want)
			return
		}
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
			assertError(t, err, c.want)
			return
		}
		assertNoError(t, err)
		if got != c.want.state {
			t.Fatalf("Target = %q, want %q", got, c.want.state)
		}
	case "apply":
		expected := argOf(c.expected, c.expectedValue, c.expectedIsValue)
		actual := argOf(c.actual, c.actualValue, c.actualIsValue)
		to, changed, err := m.apply(expected, c.event, actual)
		if c.want.error != "" {
			assertError(t, err, c.want)
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

// persistDSN is the DSN of the dialect that FSM_TEST_DIALECT names: sqlite, the default, is a new file of the test's temporary
// directory; postgres and mysql take their DSN from FSM_TEST_PG_DSN and FSM_TEST_MYSQL_DSN. A missing DSN fails the case, so no
// dialect is skipped.
func persistDSN(t *testing.T) (dsn, dialect string) {
	t.Helper()
	dialect = os.Getenv("FSM_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	switch dialect {
	case "sqlite":
		dsn = "sqlite://" + filepath.Join(t.TempDir(), "persist.db")
	case "postgres", "mysql":
		variable := "FSM_TEST_PG_DSN"
		if dialect == "mysql" {
			variable = "FSM_TEST_MYSQL_DSN"
		}
		dsn = os.Getenv(variable)
		if dsn == "" {
			t.Fatalf("%s is not set: the %s persist cases need a database DSN and never skip", variable, dialect)
		}
	default:
		t.Fatalf("FSM_TEST_DIALECT must be sqlite, postgres or mysql, it is %q", dialect)
	}
	return dsn, dialect
}

// openDSN opens the persist database of dsn with the B-4 example, closes it when the test ends, and checks its dialect.
func openDSN(t *testing.T, dsn, dialect string) *orm.DB {
	t.Helper()
	db, err := examples.Open(dsn)
	assertNoError(t, err)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close: %v", err)
		}
	})
	if db.Driver() != dialect {
		t.Fatalf("the database is %s, want %s", db.Driver(), dialect)
	}
	return db
}

// openPersistDB opens the database of one persist case on the dialect of persistDSN. The rows of the persist table are cleared,
// so a case reads only the row it seeds.
func openPersistDB(t *testing.T) *orm.DB {
	t.Helper()
	dsn, dialect := persistDSN(t)
	db := openDSN(t, dsn, dialect)
	rows, err := model.Item().Connect(db).Gets()
	assertNoError(t, err)
	assertNoError(t, rows.Delete())
	return db
}

// runPersist runs one persist case: the row 1 holds the stored code, one transition runs, and the stored code after the run is
// asserted.
func runPersist(t *testing.T, m machineUnderTest, c vectorCase) {
	db := openPersistDB(t)
	stored, err := m.code(keyArg(c.stored))
	assertNoError(t, err)
	assertNoError(t, examples.Seed(db, 1, stored))
	to, changed, err := examples.Transition(db, 1, m.decide(c.expected, c.event))
	if c.want.error != "" {
		assertError(t, err, c.want)
	} else {
		assertNoError(t, err)
		want, err := m.code(keyArg(c.want.storedAfter))
		assertNoError(t, err)
		if to != want || changed != c.want.changed {
			t.Fatalf("Transition = to %d changed %t, want to %d changed %t", to, changed, want, c.want.changed)
		}
	}
	got, err := examples.StatusOf(db, 1)
	assertNoError(t, err)
	want, err := m.code(keyArg(c.want.storedAfter))
	assertNoError(t, err)
	if got != want {
		t.Fatalf("the stored code after the run is %d, want %d", got, want)
	}
}
