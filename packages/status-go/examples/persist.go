// Package examples is the B-4 persistence pattern (docs/spec/status.md, B-4) with polyspec orm on SQLite (docs/plans/status-v1.md,
// C-2). A row keeps the status code. A transition runs in one transaction: the row is read under its lock (ForUpdate), the event
// is applied to the state that the caller observed, and the row is updated only when the state changed. The caller passes the
// same observed state on a retry, so a retry is Unchanged and a stale request is E_CONFLICT. The model is generated from the
// root schema/persist.dbs into ./model.
package examples

import (
	"github.com/polyspec/orm/packages/orm-go/orm"
	_ "github.com/polyspec/orm/packages/orm-go/orm/sqlite"

	"github.com/polyspec/status-go/examples/model"
	"github.com/polyspec/status-go/src/order"
)

// Open opens the SQLite database of dsn (sqlite://<path>) and creates the persist tables in it.
func Open(dsn string) (*orm.DB, error) {
	db, err := model.Connect(dsn, orm.Config{})
	if err != nil {
		return nil, err
	}
	if err := db.Utils().Schema().Install(model.Schema); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// Seed stores the state as the status of the row id.
func Seed(db *orm.DB, id int64, state order.State) error {
	code, err := order.Code(state)
	if err != nil {
		return err
	}
	_, err = model.Item().Connect(db).SetId(id).SetStatus(code).Create()
	return err
}

// StatusOf returns the state stored in the row id.
func StatusOf(db *orm.DB, id int64) (order.State, error) {
	row, err := model.Item().Connect(db).GetById(id)
	if err != nil {
		return 0, err
	}
	return order.FromCode(int64(row.GetStatus()))
}

// Transition is one attempt of the event from the observed state expected on the row id, with the functions of the order machine
// (src/order). It returns the Step of Apply. An error of Apply (E_CONFLICT, E_INVALID_TRANSITION or E_UNKNOWN_CODE) is returned,
// and the transaction rolls back, so the stored state stays as it was.
func Transition(db *orm.DB, id int64, expected order.State, event order.Event) (order.Step, error) {
	var step order.Step
	err := db.Transaction(func() error {
		row, err := model.Item().Connect(db).ForUpdate().GetById(id)
		if err != nil {
			return err
		}
		state, err := order.FromCode(int64(row.GetStatus()))
		if err != nil {
			return err
		}
		step, err = order.Apply(expected, event, state)
		if err != nil {
			return err
		}
		if !step.Changed {
			return nil
		}
		code, err := order.Code(step.To)
		if err != nil {
			return err
		}
		_, err = row.SetStatus(code).Update()
		return err
	})
	if err != nil {
		return order.Step{}, err
	}
	return step, nil
}
