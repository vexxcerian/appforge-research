// Turns a business profile into a module plan: which screens the app gets,
// whether each is built natively or links to a tool the business already uses,
// what content is still missing, and the tab bar.

import { loadModules, loadIndustryMap } from './assets.js';

const PRIORITY = { always: 0, core: 1, rule: 1, opportunity: 2, recommended: 3 };

// Modules whose content only the owner can supply.
const OWNER_CONTENT = new Set(['staff_profiles', 'gallery', 'portfolio', 'listings', 'loyalty', 'events_calendar', 'class_schedule', 'donations', 'client_forms']);

// What a customer most often opens the app to do, by module. Drives the tab bar.
const TAB_RANK = ['online_ordering', 'menu', 'appointment_booking', 'reservations', 'services_list', 'product_catalog', 'quote_request', 'class_schedule', 'events_calendar', 'listings', 'specials', 'portfolio', 'donations', 'hours', 'contact'];

// Tool types that turn a module into a deep link.
const TOOL_FOR_MODULE = {
  online_ordering: ['online_ordering', 'delivery_platform'],
  reservations: ['reservations'],
  appointment_booking: ['appointment_booking'],
  product_catalog: ['ecommerce_store'],
  quote_request: ['quote_form'],
  loyalty: ['loyalty_program'],
};

export async function planFeatures(profile, options = {}) {
  const [modulesCfg, industryMap] = await Promise.all([loadModules(), loadIndustryMap()]);
  return planFeaturesWith(profile, { modulesCfg, industryMap, ...options });
}

/**
 * @param {object} profile business profile
 * @param {{ modulesCfg: object, industryMap: object, maxModules?: number, allowUnconfirmed?: boolean }} cfg
 */
export function planFeaturesWith(profile, { modulesCfg, industryMap, maxModules = 10, allowUnconfirmed = false }) {
  const library = new Map(modulesCfg.modules.map((m) => [m.id, m]));
  const industry = industryMap.industries[profile.business?.industry] || industryMap.industries.other;
  const picked = new Map();
  const add = (id, source, reason) => {
    if (!library.has(id)) return;
    const prev = picked.get(id);
    // A rule (evidence about this business) explains a module better than "core for bakeries".
    if (!prev || PRIORITY[source] < PRIORITY[prev.source] || (source === 'rule' && prev.source === 'core')) picked.set(id, { id, source, reason });
  };
  const drop = (id) => picked.delete(id);

  const blockers = [];
  const warnings = [];
  if (profile.business?.status === 'permanently_closed') blockers.push('Research says the business is permanently closed.');
  if (!profile.owner_confirmed?.confirmed && !allowUnconfirmed) blockers.push('The owner has not confirmed the profile yet.');
  if (profile.confidence?.identity_match === 'uncertain' && !profile.owner_confirmed?.confirmed) blockers.push('Not sure this is the right business; the owner needs to confirm it.');
  if (!profile.owner_confirmed?.ownership_verified) warnings.push('Ownership is not verified yet. Verify before publishing to the stores.');

  for (const id of industryMap.always) add(id, 'always', 'every app');
  for (const id of industry.core) add(id, 'core', `core for ${industry.label.toLowerCase()}`);

  // Evidence-driven rules
  const tools = profile.existing_tools || [];
  for (const [moduleId, types] of Object.entries(TOOL_FOR_MODULE)) {
    const tool = tools.find((t) => types.includes(t.type));
    if (tool) add(moduleId, 'rule', `they already use ${tool.provider || tool.type.replace(/_/g, ' ')}`);
  }
  const model = profile.business?.business_model;
  if ((profile.contact?.service_area || []).length || model === 'service_area') add('service_area', 'rule', 'they serve customers across an area');
  const emergencyText = `${profile.hours?.notes || ''} ${(profile.offerings?.tags || []).join(' ')} ${profile.business?.description || ''}`;
  if (/\b(24\/7|24 hours|emergency|after[- ]hours)\b/i.test(emergencyText) && profile.contact?.phone) add('emergency_contact', 'rule', 'they advertise urgent or 24/7 service');
  const kind = profile.offerings?.kind;
  const hasItems = (profile.offerings?.categories || []).some((c) => (c.items || []).length);
  if (kind === 'menu' && hasItems) add('menu', 'rule', 'they publish a menu');
  if (kind === 'products' && hasItems) add('product_catalog', 'rule', 'they publish products');
  if ((kind === 'services' || kind === 'mixed') && hasItems && !picked.has('menu')) add('services_list', 'rule', 'they publish services');
  if (profile.reputation?.has_reviews && profile.reputation.review_count >= 10 && profile.reputation.rating >= 4) add('reviews_showcase', 'rule', `${profile.reputation.rating} stars from ${profile.reputation.review_count} reviews`);

  for (const opp of profile.app_opportunities || []) add(opp.module, 'opportunity', opp.need);
  // Recommended modules that only the owner can fill are suggested, not added:
  // an app full of "coming soon" screens looks unfinished.
  const suggested = [];
  for (const id of industry.recommended) {
    if (picked.has(id)) continue;
    if (OWNER_CONTENT.has(id)) suggested.push({ id, name: library.get(id)?.name || id, reason: `often useful for ${industry.label.toLowerCase()}; needs ${missingFor(id, profile).join(', ') || 'content'} from the owner` });
    else add(id, 'recommended', `often useful for ${industry.label.toLowerCase()}`);
  }

  if (model === 'online_only') drop('hours');
  if (!profile.contact?.phone) drop('emergency_contact');

  // Cap, keeping the highest-priority modules.
  let chosen = [...picked.values()].sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] || library.get(a.id).order - library.get(b.id).order);
  const cut = chosen.slice(maxModules);
  chosen = chosen.slice(0, maxModules);
  for (const m of cut) suggested.unshift({ id: m.id, name: library.get(m.id).name, reason: `left out to keep the app focused (${m.reason})` });

  const modules = chosen
    .sort((a, b) => library.get(a.id).order - library.get(b.id).order)
    .map((m) => describeModule(m, library.get(m.id), profile));

  const ids = modules.map((m) => m.id);
  const tabs = ['home', ...TAB_RANK.filter((id) => ids.includes(id)).slice(0, 3)];
  const more = ids.filter((id) => !tabs.includes(id));
  if (more.length) tabs.push('more');

  const owner_todo = [
    ...(profile.needs_confirmation || []).map((q) => `Answer: ${q.question}`),
    ...modules.filter((m) => !m.data_ready).map((m) => `Add content for ${m.name}: ${m.missing.join(', ')}`),
  ];

  return {
    business_name: profile.business?.name || '',
    industry: profile.business?.industry || 'other',
    industry_label: industry.label,
    blocked: blockers.length > 0,
    blockers,
    warnings,
    modules,
    navigation: { tabs, more },
    suggested,
    quick_actions: quickActions(profile, ids),
    owner_todo,
  };
}

function describeModule(pick, def, profile) {
  const types = TOOL_FOR_MODULE[def.id] || (def.deep_link_tool ? [def.deep_link_tool] : []);
  const tool = (profile.existing_tools || []).find((t) => types.includes(t.type) && t.url);
  const missing = missingFor(def.id, profile);
  return {
    id: def.id,
    name: def.name,
    order: def.order,
    source: pick.source,
    reason: pick.reason,
    mode: tool ? 'deep_link' : 'native',
    tool: tool ? { provider: tool.provider, url: tool.url, type: tool.type } : null,
    data_ready: missing.length === 0,
    missing,
  };
}

function missingFor(id, p) {
  const items = (p.offerings?.categories || []).reduce((n, c) => n + (c.items || []).length, 0);
  const m = [];
  switch (id) {
    case 'home': if (!p.business?.tagline) m.push('tagline'); break;
    case 'about': if (!p.business?.description) m.push('business story'); break;
    case 'contact': if (!p.contact?.phone && !p.contact?.email) m.push('phone or email'); break;
    case 'hours': if (!p.hours?.known) m.push('weekly hours'); break;
    case 'menu': case 'services_list': case 'product_catalog': if (!items) m.push(id === 'menu' ? 'menu items' : id === 'product_catalog' ? 'products' : 'services'); break;
    case 'service_area': if (!(p.contact?.service_area || []).length) m.push('towns or radius served'); break;
    case 'specials': m.push('current specials (optional)'); break;
    case 'faq': m.push('common questions and answers'); break;
    case 'reviews_showcase': if (!p.reputation?.has_reviews) m.push('a review link'); break;
    case 'online_ordering': case 'appointment_booking': case 'reservations': case 'quote_request':
      if (!p.contact?.phone && !p.contact?.email && !(p.existing_tools || []).length) m.push('where requests should go (phone or email)');
      break;
    default:
      if (OWNER_CONTENT.has(id)) m.push(({ staff_profiles: 'team members', gallery: 'photos', portfolio: 'project photos', listings: 'listings', loyalty: 'reward and stamp code', events_calendar: 'upcoming events', class_schedule: 'schedule', donations: 'giving link', client_forms: 'form links' })[id]);
  }
  return m.filter(Boolean);
}

function quickActions(p, ids) {
  const actions = [];
  const push = (id, label) => { if (actions.length < 4 && !actions.some((a) => a.id === id)) actions.push({ id, label }); };
  if (ids.includes('emergency_contact')) push('call', 'Call now');
  if (ids.includes('online_ordering')) push('order', 'Order');
  if (ids.includes('appointment_booking')) push('book', 'Book');
  if (ids.includes('reservations')) push('reserve', 'Reserve');
  if (ids.includes('quote_request')) push('quote', 'Get a quote');
  if (p.contact?.phone) push('call', 'Call');
  if (p.contact?.address_is_public && p.contact?.address?.city) push('directions', 'Directions');
  if (ids.includes('menu')) push('menu', 'Menu');
  return actions;
}
