// The persistence tests of the go package beyond the vector cases (docs/spec/fsm.md, B-4): two transitions of one row that run
// at the same time, each on its own connection, give the outcome that the pattern promises, and a deadlock runs the transaction
// again while another database error does not. They run on the dialect of FSM_TEST_DIALECT (persistDSN of conformance_test.go).
package tests

import (
	"errors"
	"sync"
	"testing"

	"github.com/polyspec/fsm/packages/go/examples"
	"github.com/polyspec/fsm/packages/go/examples/model"
	"github.com/polyspec/fsm/packages/go/src/fsm"
	"github.com/polyspec/orm/packages/go/orm"
)

// outcome is the result of one transition.
type outcome struct {
	to      int32
	changed bool
	err     error
}

// twoConnections opens two connections to one persist database of the dialect, clears its rows and seeds row 1 in draft.
func twoConnections(t *testing.T) (*orm.DB, *orm.DB) {
	t.Helper()
	dsn, dialect := persistDSN(t)
	first := openDSN(t, dsn, dialect)
	rows, err := model.Item().Connect(first).Gets()
	assertNoError(t, err)
	assertNoError(t, rows.Delete())
	assertNoError(t, examples.Seed(first, 1, orderCode(t, "draft")))
	return first, openDSN(t, dsn, dialect)
}

// orderCode is the code of the order state key.
func orderCode(t *testing.T, key string) int32 {
	t.Helper()
	code, err := orderMachine{}.code(keyArg(key))
	assertNoError(t, err)
	return code
}

// together runs the two transitions at the same time, each on its connection, and returns their outcomes in order.
func together(first, second *orm.DB, decideFirst, decideSecond examples.Decide) [2]outcome {
	var outcomes [2]outcome
	var group sync.WaitGroup
	for index, run := range []struct {
		db     *orm.DB
		decide examples.Decide
	}{{first, decideFirst}, {second, decideSecond}} {
		group.Go(func() {
			to, changed, err := examples.Transition(run.db, 1, run.decide)
			outcomes[index] = outcome{to, changed, err}
		})
	}
	group.Wait()
	return outcomes
}

// TestPersistConcurrentSameEvent asserts that two transitions with the same (expected, event) at the same time give one Changed
// and one Unchanged, both to the target.
// FSM-B4-1: two transitions of one (expected, event) at the same time: one Changed, one Unchanged (the row lock).
func TestPersistConcurrentSameEvent(t *testing.T) {
	first, second := twoConnections(t)
	next := orderMachine{}.decide("draft", "next")
	outcomes := together(first, second, next, next)
	paid := orderCode(t, "paid")
	for _, o := range outcomes {
		assertNoError(t, o.err)
		if o.to != paid {
			t.Fatalf("a transition went to %d, want %d", o.to, paid)
		}
	}
	if outcomes[0].changed == outcomes[1].changed {
		t.Fatalf("changed = %t and %t, want one Changed and one Unchanged", outcomes[0].changed, outcomes[1].changed)
	}
	assertStored(t, first, paid)
}

// TestPersistConcurrentConflict asserts that two events from one expected state at the same time give one Changed and one
// E_CONFLICT, and that the stored state is the one of the changed run.
// FSM-B4-2: two transitions from one expected state with different events at the same time: one Changed, one E_CONFLICT.
func TestPersistConcurrentConflict(t *testing.T) {
	first, second := twoConnections(t)
	outcomes := together(first, second, orderMachine{}.decide("draft", "next"), orderMachine{}.decide("draft", "cancel"))
	var changed, failed []outcome
	for _, o := range outcomes {
		if o.err == nil {
			changed = append(changed, o)
		} else {
			failed = append(failed, o)
		}
	}
	if len(changed) != 1 || len(failed) != 1 {
		t.Fatalf("outcomes %+v, want one Changed and one error", outcomes)
	}
	if !changed[0].changed {
		t.Fatalf("the successful transition did not change the row")
	}
	var machineError *fsm.Error
	if !errors.As(failed[0].err, &machineError) || machineError.Code != fsm.CodeConflict {
		t.Fatalf("the failed transition returned %v, want E_CONFLICT", failed[0].err)
	}
	assertStored(t, first, changed[0].to)
}

// TestPersistRetryOnDeadlock asserts that a deadlock inside the transaction runs it again: the first attempt fails with the
// DEADLOCK error of orm after the row is read, and the second attempt changes the row.
// FSM-B4-3: a deadlock inside the transaction runs the transaction again.
func TestPersistRetryOnDeadlock(t *testing.T) {
	db := openPersistDB(t)
	assertNoError(t, examples.Seed(db, 1, orderCode(t, "draft")))
	next := orderMachine{}.decide("draft", "next")
	attempts := 0
	to, changed, err := examples.Transition(db, 1, func(stored int64) (int32, bool, error) {
		attempts++
		if attempts == 1 {
			return 0, false, orm.TransactionConflict("injected deadlock")
		}
		return next(stored)
	})
	assertNoError(t, err)
	if attempts != 2 {
		t.Fatalf("the transaction ran %d times, want 2", attempts)
	}
	paid := orderCode(t, "paid")
	if to != paid || !changed {
		t.Fatalf("Transition = to %d changed %t, want to %d changed true", to, changed, paid)
	}
	assertStored(t, db, paid)
}

// TestPersistNoRetryOnOtherError asserts that a database error other than a deadlock is returned after one attempt and that the
// row keeps its state.
// FSM-B4-4: another database error is returned after one attempt, with no second run.
func TestPersistNoRetryOnOtherError(t *testing.T) {
	db := openPersistDB(t)
	draft := orderCode(t, "draft")
	assertNoError(t, examples.Seed(db, 1, draft))
	attempts := 0
	_, _, err := examples.Transition(db, 1, func(int64) (int32, bool, error) {
		attempts++
		return 0, false, &orm.Error{Code: orm.CodeConnectionLost, Msg: "injected"}
	})
	if attempts != 1 {
		t.Fatalf("the transaction ran %d times, want 1", attempts)
	}
	if orm.ErrorCode(err) != orm.CodeConnectionLost {
		t.Fatalf("Transition returned %v, want the injected CONNECTION_LOST error", err)
	}
	assertStored(t, db, draft)
}

// assertStored asserts the code stored in row 1.
func assertStored(t *testing.T, db *orm.DB, want int32) {
	t.Helper()
	got, err := examples.StatusOf(db, 1)
	assertNoError(t, err)
	if got != want {
		t.Fatalf("the stored code is %d, want %d", got, want)
	}
}
