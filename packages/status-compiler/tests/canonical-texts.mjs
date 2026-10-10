// The canonical bytes of the JSON and the Mermaid checkouts (docs/plans/status-v1.md, C-5; docs/spec/status.md, B-1 and B-2):
// the JSON texts use two spaces of indentation, the key order of the store and the $schema path of machines/; the Mermaid
// texts use the line order of the canonical form. The store tests and the CLI tests compare files with these texts, so a
// change of either canonical form fails both.

/** The machine `order`: draft (initial) -next-> done (final). */
export const ORDER_TEXT = `{
  "$schema": "../schema/status.schema.json",
  "machine": "order",
  "states": [
    {
      "key": "draft",
      "code": 1,
      "initial": true
    },
    {
      "key": "done",
      "code": 2,
      "final": true
    }
  ],
  "events": [
    {
      "key": "next",
      "edges": [
        {
          "from": "draft",
          "to": "done"
        }
      ]
    }
  ]
}
`;

/** The machine `track`: one state that is initial and final, and no event. */
export const TRACK_TEXT = `{
  "$schema": "../schema/status.schema.json",
  "machine": "track",
  "states": [
    {
      "key": "only",
      "code": 1,
      "initial": true,
      "final": true
    }
  ],
  "events": []
}
`;

/** The lock of `order` and `track`, in the canonical order: machines by name, codes numerically, reserved ascending. */
export const LOCK_TEXT = `{
  "order": {
    "codes": {
      "1": "draft",
      "2": "done"
    },
    "reserved": [
      3
    ]
  },
  "track": {
    "codes": {
      "1": "only"
    },
    "reserved": []
  }
}
`;

/** The lock of `order` alone, as written when only `order` is defined. */
export const ORDER_LOCK_TEXT = `{
  "order": {
    "codes": {
      "1": "draft",
      "2": "done"
    },
    "reserved": []
  }
}
`;

/** The machine `order` of the Mermaid canonical form: draft (initial) -next-> done (final). */
export const ORDER_MMD_TEXT = `---
title: order
---
stateDiagram-v2
    draft : 1
    done : 2
    [*] --> draft
    draft --> done : next
    done --> [*]
`;

/** The machine `track` of the Mermaid canonical form: one state that is initial and final, and no event. */
export const TRACK_MMD_TEXT = `---
title: track
---
stateDiagram-v2
    only : 1
    [*] --> only
    only --> [*]
`;

/** The order example of docs/spec/status.md, B-1, in the Mermaid canonical form, copied from that section. */
export const SPEC_ORDER_MMD_TEXT = `---
title: order
---
stateDiagram-v2
    draft : 1
    paid : 2
    shipped : 3
    done : 4
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
