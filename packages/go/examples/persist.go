// Package examples is the B-4 persistence pattern (docs/spec/fsm.md, B-4) with polyspec orm on SQLite, PostgreSQL and MySQL
// (docs/plans/fsm-v1/plan.md, C-2 and C-6; the DSN selects the dialect). A row keeps the status code. A transition runs in one
// transaction: the row is read under its lock (ForUpdate), the event is applied by the machine to the code that is stored, and
// the row is updated only when the stored state changed. The caller passes the same observed state on a retry, so a retry is
// Unchanged and a stale request is E_CONFLICT. The machine is given as a Decide, so one example serves every machine of the
// package. The model is generated from the root contracts/schema/persist.dbs into ./model.
package examples

import (
	"errors"

	"github.com/polyspec/orm/packages/go/orm"
	_ "github.com/polyspec/orm/packages/go/orm/pg"
	_ "github.com/polyspec/orm/packages/go/orm/sqlite"

	"github.com/polyspec/fsm/packages/go/examples/model"
)

// Decide is one step of a machine on the code stored in the row. It applies the event that the caller observed in its expected
// state to the stored code (the Apply of the machine on FromCode of the stored value, docs/spec/fsm.md, B-4), and returns the code
// of the state that the event leads to and whether the stored state changed. An error of Apply is returned unchanged.
type Decide func(stored int64) (to int32, changed bool, err error)

// Open opens the database of dsn (sqlite://<path>, postgres:// or mysql://) and creates the persist tables in it.
func Open(dsn string) (*orm.DB, error) {
	db, err := model.Connect(dsn, orm.Config{})
	if err != nil {
		return nil, err
	}
	if err := db.Utils().Schema().Install(model.Schema); err != nil {
		return nil, errors.Join(err, db.Close())
	}
	return db, nil
}

// Seed stores the code as the status of the row id.
func Seed(db *orm.DB, id int64, code int32) error {
	_, err := model.Item().Connect(db).SetId(id).SetStatus(code).Create()
	return err
}

// StatusOf returns the code stored in the row id.
func StatusOf(db *orm.DB, id int64) (int32, error) {
	row, err := model.Item().Connect(db).GetById(id)
	if err != nil {
		return 0, err
	}
	return row.GetStatus(), nil
}

// Transition is one attempt on the row id: the row is read under its lock, decide runs on the stored code, and the row is updated
// only when the stored state changed. It returns the code of the target and whether the stored state changed. An error of decide
// (E_CONFLICT, E_INVALID_TRANSITION or E_UNKNOWN_CODE) is returned, and the transaction rolls back, so the stored state stays as it
// was.
func Transition(db *orm.DB, id int64, decide Decide) (int32, bool, error) {
	var to int32
	var changed bool
	err := db.Transaction(func() error {
		row, err := model.Item().Connect(db).ForUpdate().GetById(id)
		if err != nil {
			return err
		}
		to, changed, err = decide(int64(row.GetStatus()))
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}
		_, err = row.SetStatus(to).Update()
		return err
	})
	if err != nil {
		return 0, false, err
	}
	return to, changed, nil
}
