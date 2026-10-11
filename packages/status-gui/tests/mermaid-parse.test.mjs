// The parse test of the pinned Mermaid package (docs/spec/status.md, B-1 and B-5; docs/plans/status-v1.md, C-7 and S-16). It
// checks the canonical form against the Mermaid version that the GUI ships, and it decides which words Mermaid cannot carry
// as state keys, so that the reserved lists of packages/status-compiler/src/core/reserved.mjs are the measured ones.
//
// A word is unusable as a state key at a position when Mermaid either fails to parse the diagram, or parses it into a model
// other than the one written (docs/spec/status.md, B-5 names the collision with the [*] ids). The second case is needed: with
// this Mermaid version, `state`, `acctitle` and `accdescr` parse without error but lose the line, the code or the state, so
// the written model differs without any collision. A word that is usable at every position fails the test, because the list
// would then reserve a word that Mermaid carries.
//
// The title words null, true and false are checked with the YAML rule of the frontmatter, because Mermaid's stateDiagram
// does not read the frontmatter title (its parsed diagram has no title for any key, including order). A title that YAML reads
// as anything but its text is not carried.

import './support/dompurify.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { MACHINE_LITERALS, MERMAID_STATE_KEYS } from '../../status-compiler/src/core/reserved.mjs';
import { ORDER_MERMAID_TEXT } from './canonical.mjs';

const mermaid = (await import('mermaid')).default;

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The ordering of the models: by text, so that both sides of a comparison are sorted the same way. */
const byText = (a, b) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The model of a parsed diagram: its states with their descriptions and its transitions with their labels, both sorted. */
async function parsedModel(text) {
  const { diagramType } = await mermaid.parse(text);
  const { db } = await mermaid.mermaidAPI.getDiagramFromText(text);
  const states = [...db.getStates().entries()].map(([id, state]) => [id, [...state.descriptions]]).sort(byText);
  const relations = db.getRelations().map(({ id1, id2, relationTitle }) => [id1, id2, relationTitle]).sort(byText);
  return { diagramType, states, relations };
}

/**
 * The model that a written diagram must parse into: the declared states with their codes, the two pseudo states of the [*]
 * ends, and the transitions in the labels they were written with. A `[*]` end is the id root_start or root_end in Mermaid.
 */
function writtenModel({ states, initial, edges }) {
  const described = states.map(([key, code]) => [key, [String(code)]]);
  const relations = [['root_start', initial, '']];
  for (const [from, to, label] of edges) {
    relations.push([from === '[*]' ? 'root_start' : from, to === '[*]' ? 'root_end' : to, label]);
  }
  return {
    diagramType: 'stateDiagram',
    states: [...described, ['root_start', []], ['root_end', []]].sort(byText),
    relations: relations.sort(byText),
  };
}

/** The canonical text (docs/spec/status.md, B-1) of a written diagram, with the line order of mermaidText. */
function textOf({ states, initial, edges }) {
  const lines = ['---', 'title: order', '---', 'stateDiagram-v2'];
  for (const [key, code] of states) lines.push(`    ${key} : ${code}`);
  lines.push(`    [*] --> ${initial}`);
  for (const [from, to, label] of edges) lines.push(`    ${from} --> ${to}${label === '' ? '' : ` : ${label}`}`);
  return `${lines.join('\n')}\n`;
}

/**
 * The five positions of a state key (B-5): a description line, the initial line, an edge as the source, an edge as the target,
 * and the final line. Every other key of the diagram is an ordinary key, so the word is the only key that Mermaid may refuse.
 */
const POSITIONS = {
  description: word => ({
    states: [['draft', 1], [word, 2], ['done', 3]],
    initial: 'draft',
    edges: [['draft', 'done', 'next'], ['done', '[*]', '']],
  }),
  initial: word => ({
    states: [[word, 1], ['done', 2]],
    initial: word,
    edges: [[word, 'done', 'next'], ['done', '[*]', '']],
  }),
  edge_source: word => ({
    states: [['draft', 1], [word, 2], ['done', 3]],
    initial: 'draft',
    edges: [['draft', 'done', 'next'], [word, 'done', 'next'], ['done', '[*]', '']],
  }),
  edge_target: word => ({
    states: [['draft', 1], [word, 2], ['done', 3]],
    initial: 'draft',
    edges: [['draft', word, 'next'], ['done', '[*]', '']],
  }),
  final: word => ({
    states: [['draft', 1], [word, 2]],
    initial: 'draft',
    edges: [['draft', word, 'next'], [word, '[*]', '']],
  }),
};

/** Whether Mermaid carries the diagram of `spec` as written, with the reason when it does not. */
async function carriesAsWritten(spec) {
  let model;
  try {
    model = await parsedModel(textOf(spec));
  } catch (error) {
    return { carried: false, reason: `parse fails: ${error.message.split('\n')[0]}` };
  }
  const expected = writtenModel(spec);
  if (JSON.stringify(model) === JSON.stringify(expected)) return { carried: true, reason: 'parsed as written' };
  return { carried: false, reason: `parsed model differs: ${JSON.stringify(model)}` };
}

test('the installed mermaid is the version that package.json pins exactly', () => {
  const pinned = JSON.parse(readFileSync(path.join(GUI, 'package.json'), 'utf8')).dependencies.mermaid;
  assert.match(pinned, /^\d+\.\d+\.\d+$/);
  const installed = JSON.parse(readFileSync(path.join(GUI, 'node_modules', 'mermaid', 'package.json'), 'utf8')).version;
  assert.equal(installed, pinned);
});

test('the canonical order example parses with the pinned mermaid, and the diagram has the codes and the labels', async () => {
  const model = await parsedModel(ORDER_MERMAID_TEXT);
  assert.equal(model.diagramType, 'stateDiagram');
  assert.deepEqual(model.states, [
    ['canceled', ['5']],
    ['done', ['4']],
    ['draft', ['1']],
    ['paid', ['2']],
    ['root_end', []],
    ['root_start', []],
    ['shipped', ['3']],
  ]);
  assert.deepEqual(model.relations, [
    ['canceled', 'root_end', ''],
    ['done', 'root_end', ''],
    ['draft', 'canceled', 'cancel'],
    ['draft', 'paid', 'next'],
    ['paid', 'canceled', 'cancel'],
    ['paid', 'draft', 'prev'],
    ['paid', 'shipped', 'next'],
    ['root_start', 'draft', ''],
    ['shipped', 'done', 'next'],
    ['shipped', 'paid', 'prev'],
  ].sort(byText));
});

for (const word of MERMAID_STATE_KEYS) {
  for (const position of Object.keys(POSITIONS)) {
    test(`reserved ${word} is unusable as a state key at ${position}`, async () => {
      const verdict = await carriesAsWritten(POSITIONS[position](word));
      assert.equal(verdict.carried, false, `${word} as ${position}: ${verdict.reason}`);
    });
  }
}

for (const word of ['paid', 'notes', 'stylish', 'clicked', 'hrefs', 'defaults', 'state_one', 'accent_color']) {
  for (const position of Object.keys(POSITIONS)) {
    test(`ordinary key ${word} is carried as written at ${position}`, async () => {
      const verdict = await carriesAsWritten(POSITIONS[position](word));
      assert.equal(verdict.carried, true, `${word} as ${position}: ${verdict.reason}`);
    });
  }
}

test('each literal that B-5 reserves as a machine key is not carried by the title line of the frontmatter', () => {
  for (const word of MACHINE_LITERALS) {
    const title = parseYaml(`title: ${word}\n`).title;
    const carried = typeof title === 'string' && title === word;
    assert.equal(carried, false, `${word} is read as ${JSON.stringify(title)}`);
  }
  assert.equal(parseYaml('title: order\n').title, 'order');
});
