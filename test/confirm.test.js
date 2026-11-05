import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoursText, formatHours, ensureConfirmations, applyOwnerAnswers, buildReview, verificationOptions, markOwnershipVerified } from '../src/confirm.js';
import { validate } from '../src/schema-tools.js';
import { SAMPLE, SCHEMA, clone } from './helpers.js';

test('parseHoursText reads the ways owners type hours', () => {
  assert.deepEqual(parseHoursText('Mon-Fri 7am-2pm, Sat 8-12; Sun closed'), [
    ...['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({ day, open: '07:00', close: '14:00' })),
    { day: 'sat', open: '08:00', close: '12:00' },
  ]);
  assert.deepEqual(parseHoursText('Tues - Sat: 11:00 AM - 2:30 PM & 5pm-9pm'), ['tue', 'wed', 'thu', 'fri', 'sat'].flatMap((day) => [
    { day, open: '11:00', close: '14:30' },
    { day, open: '17:00', close: '21:00' },
  ]));
  assert.deepEqual(parseHoursText('Mon, Wed, Fri 9-5'), ['mon', 'wed', 'fri'].map((day) => ({ day, open: '09:00', close: '17:00' })));
  assert.deepEqual(parseHoursText('Fri-Sat 6pm-2am'), [{ day: 'fri', open: '18:00', close: '02:00' }, { day: 'sat', open: '18:00', close: '02:00' }]);
  assert.equal(parseHoursText('Daily 6am to midnight').length, 7);
  assert.equal(parseHoursText('Weekends 10-4').length, 2);
  assert.deepEqual(parseHoursText('Sat noon-5pm'), [{ day: 'sat', open: '12:00', close: '17:00' }]);
  assert.deepEqual(parseHoursText('By appointment only'), []);
});

test('formatHours groups matching days', () => {
  assert.equal(formatHours(SAMPLE.hours.weekly), 'Tue-Fri 07:00-14:00, Sat 08:00-13:00');
  assert.equal(formatHours(parseHoursText('Mon 9-5, Wed 9-5')), 'Mon 09:00-17:00, Wed 09:00-17:00');
  assert.equal(formatHours(parseHoursText('Tue 11-2 & 5-9')), 'Tue 11:00-14:00 & 17:00-21:00');
});

test('ensureConfirmations adds required questions without duplicating', () => {
  const p = clone(SAMPLE);
  p.needs_confirmation = [];
  p.confidence.identity_match = 'likely';
  p.brand.colors = [{ hex: '#336699', role: 'primary', basis: 'inferred' }];
  p.offerings.categories = [];
  const out = ensureConfirmations(p, { placesUsed: true });
  const fields = out.needs_confirmation.map((q) => q.field);
  assert.ok(fields.includes('business.name'));
  assert.ok(fields.includes('hours'));
  assert.ok(fields.includes('offerings'));
  assert.ok(fields.includes('brand.colors'));
  assert.equal(new Set(fields).size, fields.length);
  assert.equal(ensureConfirmations(out, { placesUsed: true }).needs_confirmation.length, fields.length, 'idempotent');
  assert.match(out.needs_confirmation.find((q) => q.field === 'business.name').question, /214 Main St, Riverbend, AL/);
});

test('owner answers confirm the profile and record owner provenance', () => {
  const p = ensureConfirmations(clone(SAMPLE), { placesUsed: true });
  const review = buildReview(p);
  assert.equal(review.questions.find((q) => q.field === 'hours').input, 'hours');
  const { profile, identityRejected, remaining } = applyOwnerAnswers(p, [
    { field: 'hours', value: 'Tue-Fri 7am-3pm, Sat 8am-1pm' },
    { field: 'offerings', accepted: true },
  ], { now: new Date('2026-11-06T15:00:00Z') });
  assert.equal(identityRejected, false);
  assert.deepEqual(remaining, []);
  assert.equal(profile.owner_confirmed.confirmed, true);
  assert.equal(profile.owner_confirmed.confirmed_at, '2026-11-06T15:00:00Z');
  assert.equal(profile.hours.weekly[0].close, '15:00');
  assert.equal(profile.hours.basis, 'owner');
  assert.equal(profile.facts_provenance.find((f) => f.field === 'hours').basis, 'owner');
  assert.deepEqual(validate(SCHEMA, profile), []);
});

test('skipped questions stay open; a "no" on identity blocks the build', () => {
  const p = ensureConfirmations(clone(SAMPLE), { placesUsed: true });
  const skipped = applyOwnerAnswers(p, [{ field: 'hours' }]);
  assert.equal(skipped.profile.owner_confirmed.confirmed, false);
  assert.ok(skipped.remaining.some((q) => q.field === 'hours'));

  const q = clone(p);
  q.confidence.identity_match = 'uncertain';
  const withId = ensureConfirmations(q);
  const res = applyOwnerAnswers(withId, [{ field: 'business.name', value: 'no' }]);
  assert.equal(res.identityRejected, true);
  assert.equal(res.profile.owner_confirmed.confirmed, false);
  assert.equal(res.profile.confidence.identity_match, 'uncertain');
});

test('owner-typed colors, offerings and address are parsed', () => {
  const p = clone(SAMPLE);
  p.needs_confirmation = [];
  const { profile } = applyOwnerAnswers(p, [
    { field: 'brand.colors', value: 'green #2f5d3a and gold #e0a030' },
    { field: 'offerings', value: 'Sourdough - $9\nCinnamon roll $4.50\nCustom cakes' },
    { field: 'contact.address', value: '300 Oak Ave, Riverbend, AL 35001' },
    { field: 'contact.phone', value: '(256) 555-0199' },
  ]);
  assert.deepEqual(profile.brand.colors.map((c) => [c.hex, c.role]), [['#2f5d3a', 'primary'], ['#e0a030', 'secondary']]);
  assert.deepEqual(profile.offerings.categories[0].items.map((i) => [i.name, i.price]), [['Sourdough', '$9'], ['Cinnamon roll', '$4.50'], ['Custom cakes', '']]);
  assert.deepEqual(profile.contact.address, { street: '300 Oak Ave', city: 'Riverbend', region: 'AL', postal_code: '35001', country: 'US' });
  assert.equal(profile.contact.phone, '(256) 555-0199');
  assert.deepEqual(validate(SCHEMA, profile), []);
});

test('ownership verification options depend on what is published', () => {
  const methods = verificationOptions(SAMPLE).map((o) => o.method);
  assert.deepEqual(methods, ['code_to_listed_phone', 'code_to_domain_email', 'google_business_profile', 'in_person']);
  const gmail = clone(SAMPLE);
  gmail.contact.email = 'juniper@gmail.com';
  assert.ok(!verificationOptions(gmail).some((o) => o.method === 'code_to_domain_email'), 'free email is not proof');
  const v = markOwnershipVerified(SAMPLE, 'code_to_listed_phone');
  assert.equal(v.owner_confirmed.ownership_verified, true);
  assert.equal(SAMPLE.owner_confirmed.ownership_verified, false, 'input not mutated');
});
