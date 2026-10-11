// The canonical texts of the GUI tests (docs/spec/fsm.md, B-1): the order example of the spec, as its JSON file and as its
// Mermaid canonical form. The tests compare the page with these literal texts, so a change of the canonical form fails them.

/** The order example of B-1 as machines/order.fsm.json, in the canonical JSON layout of the JSON store. */
export const ORDER_JSON_TEXT = `{
  "$schema": "../schema/fsm.schema.json",
  "machine": "order",
  "states": [
    {
      "key": "draft",
      "code": 1,
      "initial": true
    },
    {
      "key": "paid",
      "code": 2
    },
    {
      "key": "shipped",
      "code": 3
    },
    {
      "key": "done",
      "code": 4,
      "final": true
    },
    {
      "key": "canceled",
      "code": 5,
      "final": true
    }
  ],
  "events": [
    {
      "key": "next",
      "edges": [
        {
          "from": "draft",
          "to": "paid"
        },
        {
          "from": "paid",
          "to": "shipped"
        },
        {
          "from": "shipped",
          "to": "done"
        }
      ]
    },
    {
      "key": "prev",
      "edges": [
        {
          "from": "paid",
          "to": "draft"
        },
        {
          "from": "shipped",
          "to": "paid"
        }
      ]
    },
    {
      "key": "cancel",
      "edges": [
        {
          "from": "draft",
          "to": "canceled"
        },
        {
          "from": "paid",
          "to": "canceled"
        }
      ]
    }
  ]
}
`;

/** The order example of B-1 in the Mermaid canonical form, copied from docs/spec/fsm.md. */
export const ORDER_MERMAID_TEXT = `---
title: order
---
stateDiagram-v2
    state "draft" as draft
    draft : 1
    state "paid" as paid
    paid : 2
    state "shipped" as shipped
    shipped : 3
    state "done" as done
    done : 4
    state "canceled" as canceled
    canceled : 5
    [*] --> draft
    draft --> paid : next
    paid --> shipped : next
    shipped --> done : next
    paid --> draft : prev
    shipped --> paid : prev
    draft --> canceled : cancel
    paid --> canceled : cancel
    done --> [*]
    canceled --> [*]
`;

/** A machine with two initial states, which the core refuses with E_INITIAL_COUNT. */
export const BAD_JSON_TEXT = `{
  "machine": "bad",
  "states": [
    { "key": "a", "code": 1, "initial": true },
    { "key": "b", "code": 2, "initial": true, "final": true }
  ],
  "events": [
    { "key": "go", "edges": [{ "from": "a", "to": "b" }] }
  ]
}
`;

/** The lock of the order example: its five codes, and no reserved code (docs/spec/fsm.md, B-3). */
export const ORDER_LOCK_TEXT = `{
  "order": {
    "codes": {
      "1": "draft",
      "2": "paid",
      "3": "shipped",
      "4": "done",
      "5": "canceled"
    },
    "reserved": []
  }
}
`;
