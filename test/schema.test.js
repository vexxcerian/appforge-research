import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { validate, sanitize, toWireSchema, schemaStats, defaultFor, getPath, setPath } from '../src/schema-tools.js';
import { CODE_FIELDS } from '../src/research.js';
import { loadModules, loadIndustryMap } from '../src/assets.js';
import { SAMPLE, SCHEMA, clone } from './helpers.js';

const ajv = new Ajv2020.default({ allErrors: true, strict: true });
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
const ajvValidate = ajv.compile(SCHEMA);

test('the schema is valid JSON Schema 2020-12 and the sample profile passes it', () => {
  assert.equal(ajvValidate(SAMPLE), true, JSON.stringify(ajvValidate.errors));
  assert.deepEqual(validate(SCHEMA, SAMPLE), []);
});

test('our validator agrees with Ajv on broken profiles', () => {
  const cases = [
    (p) => { p.business.industry = 'bakery'; },
    (p) => { p.hours.weekly[0].open = '7am'; },
    (p) => { p.brand.colors[0].hex = 'green'; },
    (p) => { p.reputation.rating = 7; },
    (p) => { p.business.name = 'x'.repeat(200); },
    (p) => { delete p.contact.phone; },
    (p) => { p.contact.extra = 'nope'; },
    (p) => { p.sources[1].id = 'source-1'; },
    (p) => { p.generated_at = 'yesterday'; },
    (p) => { p.business.year_founded = '19'; },
    (p) => { p.reputation.review_count = 1.5; },
    (p) => { p.differentiators = Array(7).fill('x'); },
  ];
  for (const [i, mutate] of cases.entries()) {
    const p = clone(SAMPLE);
    mutate(p);
    const ours = validate(SCHEMA, p);
    assert.equal(ajvValidate(p), false, `case ${i}: Ajv should reject`);
    assert.ok(ours.length > 0, `case ${i}: our validator should reject`);
  }
});

test('wire schema fits structured-output limits', () => {
  const wire = toWireSchema(SCHEMA, { omit: CODE_FIELDS });
  const stats = schemaStats(wire);
  assert.equal(stats.optional, 0, 'every property required');
  assert.equal(stats.unions, 0, 'no union types');
  assert.deepEqual(stats.unsupported, []);
  for (const k of CODE_FIELDS) assert.ok(!(k in wire.properties), `${k} omitted`);
  assert.ok(!('$schema' in wire) && !('$id' in wire));
  // limits moved into descriptions
  assert.match(wire.properties.business.properties.tagline.description, /At most 90 characters/);
  assert.match(wire.properties.reputation.properties.rating.description, /Maximum 5/);
  // patterns stay simple: no lookarounds or backreferences
  const patterns = JSON.stringify(wire).match(/"pattern":"[^"]+"/g) || [];
  for (const p of patterns) assert.doesNotMatch(p, /\(\?[=!<]|\\[1-9]|\\b/);
  // the wire schema itself must still be valid JSON Schema
  assert.doesNotThrow(() => new Ajv2020.default({ strict: false }).compile(wire));
});

test('schema enums match the module library and industry map', async () => {
  const modules = (await loadModules()).modules.map((m) => m.id).sort();
  const industries = Object.keys((await loadIndustryMap()).industries).sort();
  assert.deepEqual([...SCHEMA.properties.app_opportunities.items.properties.module.enum].sort(), modules);
  assert.deepEqual([...SCHEMA.properties.business.properties.industry.enum].sort(), industries);
  const map = await loadIndustryMap();
  for (const [id, ind] of Object.entries(map.industries)) {
    for (const m of [...ind.core, ...ind.recommended]) assert.ok(modules.includes(m), `${id} uses unknown module ${m}`);
  }
});

test('sanitize repairs model output into a valid profile', () => {
  const p = clone(SAMPLE);
  p.business.industry = 'Cafe_Bakery';
  p.business.price_level = 'Mid-range';
  p.business.tagline = 'word '.repeat(40);
  p.brand.colors.push({ hex: '#abc', role: 'secondary', basis: 'website_css' });
  p.brand.colors.push({ hex: 'teal', role: 'secondary', basis: 'inferred' });
  p.reputation.rating = '4.8';
  p.reputation.review_count = 212.4;
  p.business.year_founded = 'around 2019';
  p.extra_field = 1;
  delete p.audience;
  const { value, repairs } = sanitize(SCHEMA, p);
  assert.deepEqual(validate(SCHEMA, value), []);
  assert.equal(value.business.industry, 'cafe_bakery');
  assert.equal(value.business.price_level, 'unknown');
  assert.ok(value.business.tagline.length <= 90 && value.business.tagline.endsWith('…'));
  assert.ok(value.brand.colors.some((c) => c.hex === '#aabbcc'));
  assert.ok(!value.brand.colors.some((c) => c.hex === 'teal'));
  assert.equal(value.reputation.rating, 4.8);
  assert.equal(value.reputation.review_count, 212);
  assert.equal(value.business.year_founded, '');
  assert.ok(!('extra_field' in value));
  assert.deepEqual(value.audience, { primary_customers: [], languages: [], local_focus: false });
  assert.ok(repairs.length >= 8);
});

test('defaultFor builds an empty but valid profile skeleton', () => {
  const empty = defaultFor(SCHEMA);
  empty.generated_at = '2026-11-05T00:00:00Z';
  assert.deepEqual(validate(SCHEMA, empty), []);
  assert.equal(empty.business.industry, 'other');
  assert.equal(empty.business.status, 'unknown');
});

test('getPath and setPath handle dotted and indexed paths', () => {
  const o = { a: { b: [{ c: 1 }] } };
  assert.equal(getPath(o, 'a.b[0].c'), 1);
  setPath(o, 'a.b[1].c', 2);
  setPath(o, 'x.y', 'z');
  assert.equal(o.a.b[1].c, 2);
  assert.equal(o.x.y, 'z');
});
