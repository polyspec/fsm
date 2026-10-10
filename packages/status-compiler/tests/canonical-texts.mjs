// The canonical bytes of a JSON checkout (docs/plans/status-v1.md, C-5; docs/spec/status.md, B-2): two spaces of indentation,
// a final line break, the key order of the store and the $schema path of machines/. The store tests and the CLI tests
// compare files with these texts, so a change of the canonical form fails both.

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
