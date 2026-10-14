<?php

// The B-4 persistence pattern (docs/spec/fsm.md, B-4) with polyspec orm on SQLite, PostgreSQL and MySQL (docs/plans/fsm-v1.md,
// C-2 and C-6; the DSN selects the dialect). A row keeps the status code. A transition runs in one transaction: the row is read under its lock (forUpdate), the event is applied
// to the state that the caller observed, and the row is updated only when the state changed. The caller passes the same observed
// state on a retry, so a retry is Unchanged and a stale request is E_CONFLICT.
//
// The machine is a namespace of functions, so a transition takes the namespace of the machine module (such as
// Polyspec\FsmTest\Order) and calls its apply, fromCode and code functions by name. The model is generated from the root
// contracts/schema/persist.dbs into ./model; its bootstrap is loaded when a database is opened, not when this file is autoloaded,
// because `make gen` runs orm-gen after composer install.
declare(strict_types=1);

namespace Polyspec\FsmTest\Examples;

use Polyspec\Orm\Config;
use Polyspec\Orm\Db;
use Polyspec\FsmTest\Model\Item;

/** Opens the database of $dsn (sqlite://<path>, postgres:// or mysql://) and creates the persist tables in it. */
function open(string $dsn): Db
{
    require_once __DIR__ . '/model/bootstrap.php';
    $db = \Polyspec\FsmTest\Model\connect($dsn, new Config());
    $db->utils()->schema()->install(\Polyspec\FsmTest\Model\schema());
    return $db;
}

/** Stores the status code $code as the row $id. */
function seed(Db $db, int $id, int $code): void
{
    (new Item())->connect($db)->setId($id)->setStatus($code)->create();
}

/** The status code stored in the row $id. */
function statusOf(Db $db, int $id): int
{
    return (new Item())->connect($db)->id($id)->get()->getStatus();
}

/**
 * One attempt of the transition $event from the observed state $expected on the row $id, with the functions of the machine
 * module $module. It returns the Step of apply. An error of apply (E_CONFLICT, E_INVALID_TRANSITION or E_UNKNOWN_CODE) is thrown,
 * and the transaction rolls back, so the stored state stays as it was.
 */
function transition(Db $db, string $module, int $id, \UnitEnum $expected, \UnitEnum $event): object
{
    return $db->transaction(static function () use ($db, $module, $id, $expected, $event): object {
        $row = (new Item())->connect($db)->id($id)->forUpdate()->get();
        $apply = $module . '\apply';
        $fromCode = $module . '\fromCode';
        $code = $module . '\code';
        $step = $apply($expected, $event, $fromCode($row->getStatus()));
        if ($step->changed) {
            $row->setStatus($code($step->to))->update();
        }
        return $step;
    });
}
