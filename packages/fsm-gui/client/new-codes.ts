// The codes that the browser gives the states of the edit form (docs/plans/fsm-v1.md, C-7; docs/spec/fsm.md, B-3). A stored
// state keeps its code. Each state added in the browser takes the next code that the page carries, and the added states after it
// take the codes after that, in the order of the rows. The function is pure, so the test imports it without a browser; the server
// still checks every code on save (core run save).

/** A state row of the edit form: `persisted` is '1' for a stored state, and `code` is the value of its code field. */
export interface StateRow {
  persisted: string;
  code: string;
}

/** The code of each state row, in the order of the rows: a stored row keeps its code, an added row takes next, next + 1, ... */
export function codesOfAddedRows(rows: readonly StateRow[], next: number): string[] {
  let added = 0;
  return rows.map(row => (row.persisted === '1' ? row.code : String(next + added++)));
}
