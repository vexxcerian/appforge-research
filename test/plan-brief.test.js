import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFeatures } from '../src/feature-plan.js';
import { buildAppBrief, paletteFor, toAppId } from '../src/brief.js';
import { applyOwnerAnswers, ensureConfirmations } from '../src/confirm.js';
import { SAMPLE, clone } from './helpers.js';

const confirmed = (p = clone(SAMPLE)) => {
  const q = ensureConfirmations(p);
  return applyOwnerAnswers(q, q.needs_confirmation.map((x) => ({ field: x.field, accepted: true }))).profile;
};

// The same checks AppForge's pipeline runs on apps/<slug>/app.json.
const APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

test('unconfirmed profiles are blocked unless drafting', async () => {
  const plan = await planFeatures(SAMPLE);
  assert.equal(plan.blocked, true);
  assert.match(plan.blockers.join(' '), /not confirmed/);
  await assert.rejects(buildAppBrief(SAMPLE, plan), /Can't build yet/);
  assert.equal((await planFeatures(SAMPLE, { allowUnconfirmed: true })).blocked, false);
});

test('bakery plan: menu, ordering links to Square, quotes for cakes, sensible tabs', async () => {
  const plan = await planFeatures(confirmed());
  const ids = plan.modules.map((m) => m.id);
  for (const id of ['home', 'about', 'contact', 'hours', 'menu', 'online_ordering', 'specials', 'quote_request', 'reviews_showcase']) assert.ok(ids.includes(id), `missing ${id}`);
  const order = plan.modules.find((m) => m.id === 'online_ordering');
  assert.equal(order.mode, 'deep_link');
  assert.equal(order.tool.url, 'https://sweetjuniperbakehouse.square.site');
  assert.equal(plan.modules.find((m) => m.id === 'quote_request').source, 'opportunity');
  assert.deepEqual(plan.navigation.tabs.slice(0, 3), ['home', 'online_ordering', 'menu']);
  assert.equal(plan.navigation.tabs.at(-1), 'more');
  assert.equal(plan.quick_actions[0].id, 'order');
  assert.ok(plan.modules.length <= 10);
  assert.equal(order.reason, 'they already use Square Online', 'evidence beats the generic reason');
  assert.ok(!ids.includes('gallery') && plan.suggested.some((m) => m.id === 'gallery'), 'owner-only modules are suggested, not added');
  assert.ok(plan.warnings.some((w) => /Ownership is not verified/.test(w)));
});

test('rules: service-area trades get emergency and area modules; online-only drops hours', async () => {
  const p = confirmed();
  Object.assign(p.business, { industry: 'home_services', business_model: 'service_area', description: 'Plumbing repairs with 24/7 emergency service.' });
  p.contact.service_area = ['Cullman', 'Hanceville'];
  p.existing_tools = [];
  p.app_opportunities = [];
  p.offerings.kind = 'services';
  const plan = await planFeatures(p);
  const ids = plan.modules.map((m) => m.id);
  for (const id of ['services_list', 'quote_request', 'service_area', 'portfolio', 'emergency_contact']) assert.ok(ids.includes(id), id);
  assert.equal(plan.quick_actions[0].id, 'call');
  assert.equal(ids[1], 'emergency_contact', 'emergency sits right after home');

  const online = confirmed();
  online.business.business_model = 'online_only';
  assert.ok(!(await planFeatures(online)).modules.some((m) => m.id === 'hours'));
});

test('permanently closed businesses are blocked even when confirmed', async () => {
  const p = confirmed();
  p.business.status = 'permanently_closed';
  const plan = await planFeatures(p);
  assert.equal(plan.blocked, true);
});

test('module cap keeps the highest-priority modules', async () => {
  const plan = await planFeatures(confirmed(), { maxModules: 6 });
  assert.equal(plan.modules.length, 6);
  const ids = plan.modules.map((m) => m.id);
  for (const id of ['home', 'contact', 'about']) assert.ok(ids.includes(id));
  assert.ok(plan.suggested.some((m) => /left out to keep the app focused/.test(m.reason)));
});

test('brief and app.json fit AppForge', async () => {
  const p = confirmed();
  const plan = await planFeatures(p);
  const brief = await buildAppBrief(p, plan, { appIdPrefix: 'com.vexx' });
  assert.equal(brief.slug, 'sweet-juniper-bakehouse');
  assert.match(brief.manifest.slug, SLUG_RE);
  assert.match(brief.manifest.appId, APP_ID_RE);
  assert.equal(brief.manifest.appId, 'com.vexx.sweetjuniperbakehouse');
  assert.match(brief.manifest.themeColor, HEX_RE);
  assert.match(brief.manifest.backgroundColor, HEX_RE);
  assert.equal(brief.manifest.themeColor, '#3f6b4f');
  assert.deepEqual(brief.manifest.targets, { web: true, android: true, ios: true });

  const prompt = brief.prompt;
  assert.match(prompt, /Sweet Juniper Bakehouse/);
  assert.match(prompt, /id="business-data"/);
  assert.match(prompt, /deep link\..*square\.site/);
  const orderSection = prompt.split('### Order (`online_ordering`)')[1].split('###')[0];
  assert.match(orderSection, /Order Online button/);
  assert.doesNotMatch(orderSection, /add-to-cart/, 'only the deep-link instructions for a linked screen');
  assert.match(prompt, /Fraunces/);
  const embedded = JSON.parse(prompt.match(/## BUSINESS_DATA\n```json\n([\s\S]+?)\n```/)[1]);
  assert.deepEqual(embedded, brief.businessData);
  assert.doesNotMatch(prompt, /sell out before noon/, 'complaint themes stay out of the app');
  assert.doesNotMatch(prompt, /Downtown Donut/, 'competitors stay out of the app');
  assert.doesNotMatch(prompt, /yelp\.com/, 'research sources stay out of the app');
});

test('home-based businesses never expose a street address', async () => {
  const p = confirmed();
  p.contact.address_is_public = false;
  const plan = await planFeatures(p);
  const brief = await buildAppBrief(p, plan);
  assert.equal(brief.businessData.contact.address.street, '');
  assert.equal(brief.businessData.contact.maps_url, '');
  assert.ok(!plan.quick_actions.some((a) => a.id === 'directions'));
});

test('palette and app id helpers', () => {
  assert.deepEqual(paletteFor({ colors: [] }).primary, '#2563eb');
  const dark = paletteFor({ colors: [{ hex: '#050A14', role: 'background' }, { hex: '#3B82F6', role: 'primary' }] });
  assert.equal(dark.text, '#f8fafc');
  assert.equal(dark.primary, '#3b82f6');
  assert.equal(paletteFor({ colors: [{ hex: '#f5d90a', role: 'primary' }] }).on_primary, '#111827');
  assert.equal(toAppId('com.Vexx', '7-eleven'), 'com.vexx.a7eleven');
});
