// Tests that schema/status.schema.json and the core validate of packages/status-compiler/src/core/validate.mjs agree: every
// valid fixture passes both, and every structural error fixture is rejected by both with E_SCHEMA. The schema is checked with
// the keywords of scripts/kit/schema-validate.mjs, the same validator kit uses for its own schemas.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate as validateSchema } from '../../../scripts/kit/schema-validate.mjs';
import { validate } from '../src/core/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.resolve(HERE, '../../../schema/status.schema.json'), 'utf8'));
const FIXTURES = path.join(HERE, 'fixtures');

/** The fixtures of `group` as `{ name, document }`, in name order. */
function fixtures(group) {
  const directory = path.join(FIXTURES, group);
  return readdirSync(directory).filter(file => file.endsWith('.json')).sort().map(file => ({
    name: file,
    document: JSON.parse(readFileSync(path.join(directory, file), 'utf8')),
  }));
}

/** The core input of a document: the store strips $schema before the core validate is called. */
function definitionOf(document) {
  const { $schema: _schema, ...definition } = document;
  return definition;
}

const valid = fixtures('valid');
const invalid = fixtures('schema');

test('the valid fixtures are present', () => {
  assert.ok(valid.some(({ name }) => name === 'order.json'));
  assert.ok(valid.length >= 2);
});

test('the structural error fixtures are present, one per error', () => {
  assert.ok(invalid.length >= 20);
});

for (const { name, document } of valid) {
  test(`schema and core accept the valid fixture ${name}`, () => {
    assert.deepEqual(validateSchema(document, SCHEMA), []);
    assert.deepEqual(validate([definitionOf(document)]), []);
  });
}

for (const { name, document } of invalid) {
  test(`schema and core reject the structural error fixture ${name} with E_SCHEMA`, () => {
    assert.notDeepEqual(validateSchema(document, SCHEMA), []);
    const findings = validate([definitionOf(document)]);
    assert.notEqual(findings.length, 0);
    assert.ok(findings.every(finding => finding.code === 'E_SCHEMA'), JSON.stringify(findings));
  });
}
