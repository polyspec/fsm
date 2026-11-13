// Package tests runs the common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the Go
// binding of fsm (plan f6, step 7b; docs/plans/fsm-v1/checklist.md, S-467), as conformance.mjs does on the Node binding (S-461).
// The folder contracts is that of the repository, the nearest parent folder of the test that holds
// contracts/conformance/vectors.json, as test_conformance.py finds it; go test runs a test in its package folder. Each machine is MachineParse of its file
// and the reserved codes of its lock entry. A state and an event are their keys; a raw code of a vector (value, expected_value,
// actual_value) goes through Key first, as the legacy tests send it through fromCode. An error is compared by its kind and by
// the properties Expected, Actual and Event of MachineError (nil where the field does not apply, FSM-B7-5); the kind is the one
// that the mapping table contracts/conformance/changes.json gives for the vector (docs/spec/fsm.md, FSM-B7-6). A from_code input
// of an input_type (a string, a bool or a float) has no form in Go, whose FromCode takes an int64; the rule of binding GN-13
// gives such an input an entry point of the test feature case-test, which passes the host value to the conversion of the core.
// Until binding generates that entry point for Go, each such vector fails by its name with that reason. The persist vectors are
// the cases of step 7p, which binds the store.
package tests

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	fsm "github.com/polyspec/fsm/packages/go"
	liberrors "github.com/polyspec/fsm/packages/go/errors"
)

// intMax is the largest integer of the contract int: the same value in every target (docs/spec/fsm.md, B-7).
const intMax = 1<<53 - 1

// vector is a case of contracts/conformance/vectors.json; expect keeps its JSON, whose form is that of the feature.
type vector struct {
	Feature       string          `json:"feature"`
	Name          string          `json:"name"`
	ID            string          `json:"id"`
	State         string          `json:"state"`
	Event         string          `json:"event"`
	Expected      string          `json:"expected"`
	Actual        string          `json:"actual"`
	Value         *int64          `json:"value"`
	ExpectedValue *int64          `json:"expected_value"`
	ActualValue   *int64          `json:"actual_value"`
	Code          int64           `json:"code"`
	Input         *string         `json:"input"`
	InputType     *string         `json:"input_type"`
	Expect        json.RawMessage `json:"expect"`
}

// failure is the expectation of a vector that fails: the legacy error and its fields, null where the field does not apply.
type failure struct {
	Error    string `json:"error"`
	Expected *int64 `json:"expected"`
	Actual   *int64 `json:"actual"`
	Event    *int64 `json:"event"`
}

// row is a row of the mapping table contracts/conformance/changes.json.
type row struct {
	From struct {
		Error string `json:"error"`
		When  string `json:"when"`
	} `json:"from"`
	To struct {
		Kind string `json:"kind"`
	} `json:"to"`
}

// read decodes the JSON file at path into value.
func read(t *testing.T, path string, value any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, value); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

// inputNotInt is the predicate input_not_int of the mapping table: a from_code input that is no value of the contract int.
func inputNotInt(v vector) bool {
	if v.Input == nil {
		return false
	}
	if v.InputType != nil {
		return true
	}
	number, err := strconv.ParseFloat(*v.Input, 64)
	return err != nil || math.Abs(number) > intMax
}

// kindOf is the kind of the binding in the place of the error of v: the first row of the mapping table that applies.
func kindOf(t *testing.T, rows []row, v vector, legacy string) string {
	t.Helper()
	for _, r := range rows {
		if r.From.Error == legacy && (r.From.When == "" || (r.From.When == "input_not_int" && inputNotInt(v))) {
			return r.To.Kind
		}
	}
	t.Fatalf("no row of contracts/conformance/changes.json maps %s of %s", legacy, v.ID)
	return ""
}

// fields gives the kind of err and the properties of MachineError; a nil property is a field that does not apply.
type fields struct {
	Kind                    string
	Expected, Actual, Event *int64
}

func fieldsOf(t *testing.T, err error) fields {
	t.Helper()
	var kinded interface{ Kind() string }
	if !errors.As(err, &kinded) {
		t.Fatalf("want an error of the binding with a kind, got %v", err)
	}
	got := fields{Kind: kinded.Kind()}
	var machineError *liberrors.MachineError
	if errors.As(err, &machineError) {
		got.Expected, got.Actual, got.Event = machineError.Expected(), machineError.Actual(), machineError.Event()
	}
	return got
}

// text is the value of a pointer for a message.
func text(value *int64) string {
	if value == nil {
		return "null"
	}
	return strconv.FormatInt(*value, 10)
}

// assertFailure asserts that err has the kind that the mapping table gives for v and the fields of its expectation.
func assertFailure(t *testing.T, rows []row, v vector, want failure, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("want the error %s, got no error", want.Error)
	}
	got := fieldsOf(t, err)
	wantKind := kindOf(t, rows, v, want.Error)
	same := func(a, b *int64) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }
	if got.Kind != wantKind || !same(got.Expected, want.Expected) || !same(got.Actual, want.Actual) || !same(got.Event, want.Event) {
		t.Fatalf("want kind %s expected %s actual %s event %s, got kind %s expected %s actual %s event %s (%v)", wantKind,
			text(want.Expected), text(want.Actual), text(want.Event), got.Kind, text(got.Expected), text(got.Actual), text(got.Event), err)
	}
}

// stateArg is the state argument of a vector: the key of its raw code when the vector gives one, its key otherwise.
func stateArg(machine *fsm.Machine, key string, value *int64) (string, error) {
	if value != nil {
		return machine.Key(*value)
	}
	return key, nil
}

// expectAs decodes the expectation of v into value.
func expectAs(t *testing.T, v vector, value any) {
	t.Helper()
	if err := json.Unmarshal(v.Expect, value); err != nil {
		t.Fatalf("decode the expectation of %s: %v", v.ID, err)
	}
}

// equal fails the test unless got is want.
func equal[T comparable](t *testing.T, what string, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
}

// check runs the vector v on machine with the mapping table rows.
func check(t *testing.T, rows []row, machine *fsm.Machine, v vector) {
	// An expectation that fails is an object with error; the other expectations are a value or an object without error.
	var fails failure
	if len(v.Expect) > 0 && v.Expect[0] == '{' {
		expectAs(t, v, &fails)
	}
	// result runs a call that gives a value and an error: a failing vector compares the error, another its value.
	result := func(err error, compare func()) {
		t.Helper()
		if fails.Error != "" {
			assertFailure(t, rows, v, fails, err)
			return
		}
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		compare()
	}
	var state struct {
		State string `json:"state"`
	}
	switch v.Feature {
	case "initial":
		got, err := machine.Initial()
		expectAs(t, v, &state)
		result(err, func() { equal(t, "Initial", got, state.State) })
	case "code":
		key, err := stateArg(machine, v.State, v.Value)
		var got int64
		if err == nil {
			got, err = machine.Code(key)
		}
		result(err, func() {
			var want int64
			expectAs(t, v, &want)
			equal(t, "Code", got, want)
		})
	case "key":
		got, err := machine.Key(v.Code)
		result(err, func() {
			var want string
			expectAs(t, v, &want)
			equal(t, "Key", got, want)
		})
	case "from_code":
		fromCode(t, rows, machine, v, fails, result)
	case "is_final":
		key, err := stateArg(machine, v.State, v.Value)
		var got bool
		if err == nil {
			got, err = machine.IsFinal(key)
		}
		result(err, func() {
			var want bool
			expectAs(t, v, &want)
			equal(t, "IsFinal", got, want)
		})
	case "events_from":
		got, err := machine.EventsFrom(v.State)
		result(err, func() {
			var want []string
			expectAs(t, v, &want)
			if !slices.Equal(got, want) {
				t.Fatalf("EventsFrom = %v, want %v", got, want)
			}
		})
	case "target":
		got, err := machine.Target(v.State, v.Event)
		result(err, func() {
			expectAs(t, v, &state)
			equal(t, "Target", got, state.State)
		})
	case "apply":
		expected, err := stateArg(machine, v.Expected, v.ExpectedValue)
		actual := ""
		if err == nil {
			actual, err = stateArg(machine, v.Actual, v.ActualValue)
		}
		var step fsm.Step
		if err == nil {
			step, err = machine.Apply(expected, v.Event, actual)
		}
		result(err, func() {
			var want struct {
				To      string `json:"to"`
				Changed bool   `json:"changed"`
			}
			expectAs(t, v, &want)
			equal(t, "Apply.To", step.To, want.To)
			equal(t, "Apply.Changed", step.Changed, want.Changed)
		})
	default:
		t.Fatalf("no check for the feature %s; the vectors and this file must agree", v.Feature)
	}
}

// fromCode runs a from_code vector. An input of an input_type has no form in Go (FromCode takes an int64), so the vector waits
// for the entry point of the test feature case-test that binding GN-13 gives it, and fails by its name until then.
func fromCode(t *testing.T, rows []row, machine *fsm.Machine, v vector, fails failure, result func(error, func())) {
	t.Helper()
	if v.Input == nil {
		t.Fatalf("the from_code vector %s has no input", v.ID)
	}
	if v.InputType != nil {
		t.Fatalf("%s: the %s input %s has no form in Go; it waits for the case-test entry point of binding GN-13, which passes the "+
			"host value to the conversion of the core, whose kind %s the mapping table expects", v.ID, *v.InputType, *v.Input,
			kindOf(t, rows, v, fails.Error))
	}
	code, err := strconv.ParseInt(*v.Input, 10, 64)
	if err != nil {
		t.Fatalf("the input %s of %s is no int64: %v", *v.Input, v.ID, err)
	}
	got, err := machine.FromCode(code)
	result(err, func() {
		var state struct {
			State string `json:"state"`
		}
		expectAs(t, v, &state)
		equal(t, "FromCode", got, state.State)
	})
}

// contractsDir is the folder contracts of the repository: the nearest parent folder of the working directory, the package
// folder of the test, that holds contracts/conformance/vectors.json.
func contractsDir(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatalf("the working directory of the test: %v", err)
	}
	for {
		candidate := filepath.Join(directory, "contracts")
		if _, err := os.Stat(filepath.Join(candidate, "conformance", "vectors.json")); err == nil {
			return candidate
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatal("no parent folder of the test holds contracts/conformance/vectors.json")
		}
		directory = parent
	}
}

// TestConformance runs every vector but the persist vectors as the subtest of its name, on the machine of its file.
func TestConformance(t *testing.T) {
	contracts := contractsDir(t)
	var vectors struct {
		Machines []struct {
			Machine string   `json:"machine"`
			Cases   []vector `json:"cases"`
		} `json:"machines"`
	}
	read(t, filepath.Join(contracts, "conformance/vectors.json"), &vectors)
	var lock map[string]struct {
		Reserved []int64 `json:"reserved"`
	}
	read(t, filepath.Join(contracts, "fsm.lock.json"), &lock)
	var changes struct {
		Rows []row `json:"rows"`
	}
	read(t, filepath.Join(contracts, "conformance/changes.json"), &changes)
	count := 0
	for _, entry := range vectors.Machines {
		definition, err := os.ReadFile(filepath.Join(contracts, "machines", entry.Machine+".fsm.json"))
		if err != nil {
			t.Fatalf("read the machine %s: %v", entry.Machine, err)
		}
		reserved := lock[entry.Machine].Reserved
		if reserved == nil {
			reserved = []int64{}
		}
		for _, v := range entry.Cases {
			if v.Feature == "persist" {
				continue
			}
			count++
			t.Run(v.Name, func(t *testing.T) {
				machine, err := fsm.MachineParse(string(definition), reserved)
				if err != nil {
					t.Fatalf("MachineParse %s: %v", entry.Machine, err)
				}
				check(t, changes.Rows, machine, v)
			})
		}
	}
	if count == 0 {
		t.Fatal("the vectors hold no case")
	}
}
