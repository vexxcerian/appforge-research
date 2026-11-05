import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchBusiness, parseLocation, normalizeIntake, cleanNotes, parseJsonObject, namesMatch } from '../src/research.js';
import { validate } from '../src/schema-tools.js';
import { scriptedFetch, json, researchResponses, extractionPayload, message, SCHEMA, startSite } from './helpers.js';

const placesReply = (site) => json({
  places: [{
    id: 'ChIJtest',
    displayName: { text: 'Sweet Juniper Bakehouse', languageCode: 'en' },
    formattedAddress: '214 Main St, Riverbend, AL 35000, USA',
    addressComponents: [
      { longText: '214', shortText: '214', types: ['street_number'] },
      { longText: 'Main Street', shortText: 'Main St', types: ['route'] },
      { longText: 'Riverbend', shortText: 'Riverbend', types: ['locality'] },
      { longText: 'Alabama', shortText: 'AL', types: ['administrative_area_level_1'] },
      { longText: '35000', shortText: '35000', types: ['postal_code'] },
      { longText: 'United States', shortText: 'US', types: ['country'] },
    ],
    nationalPhoneNumber: '(256) 555-0142',
    websiteUri: site,
    googleMapsUri: 'https://maps.google.com/?cid=1234567890',
    regularOpeningHours: {
      periods: [2, 3, 4, 5].map((d) => ({ open: { day: d, hour: 7, minute: 0 }, close: { day: d, hour: 14, minute: 0 } }))
        .concat([{ open: { day: 6, hour: 8, minute: 0 }, close: { day: 6, hour: 13, minute: 0 } }]),
      weekdayDescriptions: ['Monday: Closed', 'Tuesday: 7:00 AM – 2:00 PM'],
    },
    primaryType: 'bakery',
    types: ['bakery', 'store'],
    businessStatus: 'OPERATIONAL',
    rating: 4.8,
    userRatingCount: 212,
  }],
});

test('full research run: places, brand signals, paused research, extraction, repairs', async () => {
  const site = await startSite();
  try {
    const [paused, done] = researchResponses();
    const api = scriptedFetch([json(paused), json(done), json(message(JSON.stringify(extractionPayload())))]);
    const places = scriptedFetch([placesReply(site.url)]);
    const events = [];
    const out = await researchBusiness(
      { name: 'Sweet Juniper Bakehouse', location: 'Riverbend, AL' },
      { apiKey: 'k', fetchImpl: api, placesApiKey: 'g', placesFetchImpl: places, siteFetchImpl: fetch, onProgress: (e) => events.push(e.step), today: '2026-11-05' },
    );

    // Places request
    assert.equal(places.calls[0].headers['X-Goog-Api-Key'], 'g');
    assert.match(places.calls[0].headers['X-Goog-FieldMask'], /places\.regularOpeningHours/);
    assert.equal(places.calls[0].body.textQuery, 'Sweet Juniper Bakehouse, Riverbend, AL');

    // Research request: tools, location, URLs present in the user message so web_fetch may open them
    const r1 = api.calls[0].body;
    assert.equal(r1.model, 'claude-sonnet-5-5');
    assert.deepEqual(r1.tools.map((t) => t.type), ['web_search_20260318', 'web_fetch_20260318']);
    assert.equal(r1.tools[0].user_location.city, 'Riverbend');
    assert.equal(r1.tools[0].user_location.country, 'US');
    assert.match(r1.messages[0].content, /maps\.google\.com\/\?cid=1234567890/);
    assert.match(r1.messages[0].content, new RegExp(site.url.replace(/[./]/g, '\\$&')));
    assert.match(r1.system, /number your own sources from S2/);
    assert.doesNotMatch(r1.system, /\{\{[A-Z_]+\}\}/, 'no unfilled placeholders');
    assert.equal(api.calls[1].body.messages.at(-1).role, 'assistant', 'continued after pause');

    // Extraction request
    const ex = api.calls[2].body;
    assert.equal(ex.output_config.format.type, 'json_schema');
    assert.ok(!('research_meta' in ex.output_config.format.schema.properties));
    assert.doesNotMatch(ex.system, /\{\{[A-Z_]+\}\}/);
    assert.match(ex.messages[0].content, /<research_notes>\n# Research notes: Sweet Juniper/);
    assert.doesNotMatch(ex.messages[0].content, /I'll start by searching/, 'chatter before the notes is dropped');

    // Result
    const p = out.profile;
    assert.deepEqual(validate(SCHEMA, p), []);
    assert.equal(out.validation.valid, true);
    assert.equal(p.business.industry, 'cafe_bakery', 'enum casing repaired');
    assert.ok(p.business.tagline.length <= 90);
    assert.ok(!p.sources.some((s) => s.id === 'S5'), 'unseen URL dropped');
    assert.deepEqual(p.facts_provenance.find((f) => f.field === 'business.year_founded').source_ids, []);
    assert.equal(p.brand.colors[0].hex, '#3f6b4f', 'colors filled from website CSS');
    assert.equal(p.brand.colors[0].basis, 'website_css');
    assert.ok(p.needs_confirmation.some((q) => q.field === 'hours'), 'hours from Google must be confirmed');
    assert.equal(p.owner_confirmed.confirmed, false);
    assert.equal(p.research_meta.places_used, true);
    assert.equal(p.research_meta.brand_signals_used, true);
    assert.equal(p.research_meta.web_searches, 2);
    assert.ok(out.warnings.some((w) => /too_many_requests/.test(w)));
    assert.deepEqual([...new Set(events)], ['places', 'brand', 'research', 'extract', 'done']);
  } finally {
    await site.close();
  }
});

test('falls back to basic web tools when dynamic filtering is rejected', async () => {
  const [, done] = researchResponses();
  const api = scriptedFetch([
    json({ type: 'error', error: { type: 'invalid_request_error', message: 'set allowed_callers to ["direct"]' } }, 400),
    json(done),
    json(message(JSON.stringify(extractionPayload({ faults: false })))),
  ]);
  const out = await researchBusiness({ name: 'Sweet Juniper Bakehouse', location: 'Riverbend, AL' }, { apiKey: 'k', fetchImpl: api, brandSignals: false });
  assert.equal(api.calls[1].body.tools[0].type, 'web_search_20250305');
  assert.equal(out.profile.research_meta.tool_mode, 'basic');
  assert.ok(out.warnings.some((w) => /basic web tools/.test(w)));
});

test('falls back to prompt-only JSON when the schema is rejected', async () => {
  const [, done] = researchResponses();
  const api = scriptedFetch([
    json(done),
    json({ type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation.' } }, 400),
    json(message('Here is the profile:\n' + JSON.stringify(extractionPayload({ faults: false })) + '\nDone.')),
  ]);
  const out = await researchBusiness({ name: 'Sweet Juniper Bakehouse' }, { apiKey: 'k', fetchImpl: api, brandSignals: false });
  assert.ok(!('output_config' in api.calls[2].body));
  assert.match(api.calls[2].body.system, /matching this JSON Schema/);
  assert.equal(out.validation.valid, true);
});

test('a refusal or empty notes stops the run with a clear error', async () => {
  const refused = { ...message('no'), stop_reason: 'refusal' };
  await assert.rejects(
    researchBusiness({ name: 'X' }, { apiKey: 'k', fetchImpl: scriptedFetch([json(refused)]), brandSignals: false }),
    /refused/,
  );
  await assert.rejects(
    researchBusiness({ name: 'X' }, { apiKey: 'k', fetchImpl: scriptedFetch([json(message(''))]), brandSignals: false }),
    /no notes/,
  );
});

test('intake and helpers', () => {
  assert.throws(() => normalizeIntake({}), /name is required/);
  assert.equal(normalizeIntake({ name: 'A', website: 'a.com' }).website, 'https://a.com');
  assert.deepEqual(parseLocation('Cullman, AL'), { city: 'Cullman', region: 'AL', country: 'US' });
  assert.deepEqual(parseLocation('Cullman, AL 35055'), { city: 'Cullman', region: 'AL', country: 'US' });
  assert.deepEqual(parseLocation('Toronto, ON', 'ca'), { city: 'Toronto', region: 'ON', country: 'CA' });
  assert.equal(cleanNotes('blah\n# Research notes: A\n- x'), '# Research notes: A\n- x');
  assert.deepEqual(parseJsonObject('text {"a":1} more'), { a: 1 });
  assert.equal(parseJsonObject('nothing'), null);
  assert.ok(namesMatch("Angel's Num Nums", 'Angels Num Nums LLC'));
  assert.ok(!namesMatch('Joe’s Diner', 'Main Street Diner'));
});
