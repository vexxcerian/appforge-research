import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBrandSignals, rankColors, normalizeHex } from '../src/brand-signals.js';
import { simplifyPlace, periodsToWeekly, lookupPlace } from '../src/places.js';
import { startSite, scriptedFetch, json } from './helpers.js';

test('brand signals read colors, fonts, logo and socials from a real HTTP site', async () => {
  const site = await startSite();
  try {
    const b = await extractBrandSignals(site.url);
    assert.equal(b.available, true);
    assert.equal(b.theme_color, '#3f6b4f');
    assert.equal(b.colors.brand[0].hex, '#3f6b4f', 'most used brand color first, near-duplicates merged');
    assert.ok(b.colors.brand.some((c) => c.hex === '#e8a33d'));
    assert.ok(b.colors.neutrals.some((c) => c.hex === '#fbf6ee'));
    assert.deepEqual(b.fonts.slice(0, 2), ['Fraunces', 'Work Sans']);
    assert.equal(b.logo, `${site.url}images/logo.png`);
    assert.equal(b.icon, `${site.url}apple-touch-icon.png`);
    assert.deepEqual(b.social_links.map((s) => s.platform), ['facebook', 'instagram']);
    assert.ok(!b.social_links.some((s) => /sharer/.test(s.url)));
    assert.equal(b.platform, 'wix');
    assert.equal(b.stylesheets_read, 1);
  } finally {
    await site.close();
  }
});

test('brand signals fail softly', async () => {
  assert.equal((await extractBrandSignals('')).available, false);
  const down = await extractBrandSignals('http://127.0.0.1:9/', { timeoutMs: 2000 });
  assert.equal(down.available, false);
  assert.ok(down.reason);
});

test('color helpers', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('rgb(63, 107, 79)'), '#3f6b4f');
  assert.equal(normalizeHex('#3f6b4fcc'), '#3f6b4f');
  assert.equal(normalizeHex('red'), '');
  const r = rankColors('a{color:#ff0000} b{color:#fe0101} c{color:#ffffff} d{color:#00f}');
  assert.equal(r.brand[0].hex, '#ff0000');
  assert.equal(r.brand[0].count, 2);
  assert.equal(r.neutrals[0].hex, '#ffffff');
});

test('Places periods become weekly hours, including overnight and 24/7', () => {
  assert.deepEqual(periodsToWeekly([{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }]), [{ day: 'fri', open: '18:00', close: '02:00' }]);
  assert.equal(periodsToWeekly([{ open: { day: 0, hour: 0, minute: 0 } }]).length, 7);
  const s = simplifyPlace({ id: 'x', displayName: { text: 'A' }, addressComponents: [{ longText: 'Cullman', types: ['locality'] }, { longText: 'Alabama', shortText: 'AL', types: ['administrative_area_level_1'] }] });
  assert.equal(s.address.city, 'Cullman');
  assert.equal(s.address.region, 'AL');
  assert.equal(s.rating, null);
});

test('Places lookup reports errors instead of throwing', async () => {
  assert.equal((await lookupPlace({ name: 'A' }, {})).ok, false);
  const f = scriptedFetch([json({ error: { message: 'API key not valid' } }, 400)]);
  const r = await lookupPlace({ name: 'A', location: 'B' }, { apiKey: 'bad', fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.error, /API key not valid/);
});
