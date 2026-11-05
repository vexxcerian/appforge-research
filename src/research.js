// researchBusiness(): intake in, business profile out.
//
//   1. Google Places lookup (optional)       -> identity leads, website, Maps link
//   2. Brand signals from the website (Node) -> real colors, fonts, logo
//   3. Research turn: Claude + web search + web fetch -> cited Markdown notes
//   4. Extraction: Claude + structured outputs -> profile JSON
//   5. Code checks: drop unseen URLs, add required owner questions, repair, validate

import { createMessage, runServerToolTurn, extractText, collectSources, toolActivity, sumUsage, webTools, CLAUDE_DEFAULTS, ClaudeError } from './claude.js';
import { lookupPlace } from './places.js';
import { extractBrandSignals } from './brand-signals.js';
import { loadProfileSchema, loadModules, loadIndustryMap, loadPrompt, fillTemplate } from './assets.js';
import { toWireSchema, sanitize, validate } from './schema-tools.js';
import { ensureConfirmations } from './confirm.js';

/** Top-level profile fields that code fills in, not the model. */
export const CODE_FIELDS = ['schema_version', 'generated_at', 'research_meta', 'owner_confirmed'];

const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));

export function parseLocation(location = '', country = '') {
  const parts = String(location).split(',').map((s) => s.trim()).filter(Boolean);
  const city = parts[0] || '';
  const regionRaw = (parts[1] || '').replace(/\s+\d{5}(-\d{4})?$/, '').trim();
  const region = regionRaw;
  let c = (country || parts[2] || '').trim();
  if (!c && US_STATES.has(region.toUpperCase())) c = 'US';
  if (/^(usa|united states)$/i.test(c)) c = 'US';
  return { city, region, country: c.length === 2 ? c.toUpperCase() : '' };
}

export function normalizeIntake(raw = {}) {
  const intake = {
    name: String(raw.name || '').trim(),
    location: String(raw.location || raw.city || '').trim(),
    country: String(raw.country || '').trim(),
    website: String(raw.website || '').trim(),
    phone: String(raw.phone || '').trim(),
    google_maps_url: String(raw.google_maps_url || raw.maps || '').trim(),
    notes: String(raw.notes || '').trim().slice(0, 2000),
  };
  if (intake.website && !/^https?:\/\//i.test(intake.website)) intake.website = `https://${intake.website}`;
  if (!intake.name) throw new Error('Business name is required.');
  if (intake.name.length > 120) throw new Error('Business name is too long.');
  return intake;
}

/**
 * @param {object} rawIntake { name, location, website?, phone?, google_maps_url?, notes?, country? }
 * @param {object} options
 * @param {string} options.apiKey Anthropic API key
 * @param {string} [options.placesApiKey] Google Places API key (optional)
 * @param {'dynamic'|'basic'} [options.toolMode]
 * @param {boolean} [options.brandSignals] read the website's CSS (default true)
 * @param {(event: object) => void} [options.onProgress]
 */
export async function researchBusiness(rawIntake, options = {}) {
  const intake = normalizeIntake(rawIntake);
  const opts = {
    researchModel: CLAUDE_DEFAULTS.researchModel,
    extractModel: CLAUDE_DEFAULTS.extractModel,
    toolMode: 'dynamic',
    maxSearches: 8,
    maxFetches: 10,
    brandSignals: true,
    today: new Date().toISOString().slice(0, 10),
    ...options,
  };
  const api = { apiKey: opts.apiKey, baseUrl: opts.baseUrl, apiVersion: opts.apiVersion, fetchImpl: opts.fetchImpl, signal: opts.signal };
  const progress = (step, message, extra = {}) => opts.onProgress?.({ step, message, ...extra });
  const warnings = [];

  const [schema, modulesCfg, industryMap, researchPrompt, extractorPrompt] = await Promise.all([
    loadProfileSchema(), loadModules(), loadIndustryMap(), loadPrompt('research-agent'), loadPrompt('profile-extractor'),
  ]);

  // 1. Google Places
  let places = { ok: false, candidates: [] };
  if (opts.placesApiKey) {
    progress('places', 'Looking up the Google listing');
    places = await lookupPlace(intake, { apiKey: opts.placesApiKey, fetchImpl: opts.placesFetchImpl || opts.fetchImpl });
    if (!places.ok) warnings.push(`Google Places lookup skipped: ${places.error}`);
  }
  const top = places.candidates[0];
  const website = intake.website || (top && namesMatch(top.name, intake.name) ? top.website : '');

  // 2. Brand signals
  let brand = { available: false, reason: 'not run' };
  if (opts.brandSignals && website) {
    progress('brand', 'Reading colors and fonts from the website');
    brand = await extractBrandSignals(website, { fetchImpl: opts.siteFetchImpl || opts.fetchImpl });
    if (!brand.available) warnings.push(`Website colors not read: ${brand.reason}`);
  }

  // 3. Research turn
  const moduleIds = modulesCfg.modules.map((m) => m.id).join(', ');
  const system = fillTemplate(researchPrompt, {
    TODAY: opts.today,
    MAX_SEARCHES: opts.maxSearches,
    MAX_FETCHES: opts.maxFetches,
    MODULE_LIST: moduleIds,
    SOURCE_NUMBERING: places.candidates.length
      ? 'The intake is `S0: intake | Intake form | owner` and the Google listing data in the intake is `S1: <its Google Maps URL> | Google listing | google_listing`; cite them as [S0] and [S1] and number your own sources from S2, in the order you first cite them.'
      : 'The intake is `S0: intake | Intake form | owner`; cite it as [S0] and number your own sources from S1, in the order you first cite them.',
  });
  const userMessage = researchUserMessage(intake, places.candidates, website);

  progress('research', 'Researching the business on the web');
  let research;
  let toolMode = opts.toolMode;
  const researchBody = (mode) => ({
    model: opts.researchModel,
    max_tokens: 12000,
    system,
    tools: webTools({ mode, maxSearches: opts.maxSearches, maxFetches: opts.maxFetches, location: parseLocation(intake.location, intake.country) }),
    messages: [{ role: 'user', content: userMessage }],
  });
  try {
    research = await runServerToolTurn(researchBody(toolMode), api, { onProgress: opts.onProgress });
  } catch (e) {
    // Older models or some accounts reject the dynamic-filtering tool versions.
    if (toolMode === 'dynamic' && e instanceof ClaudeError && e.status === 400) {
      warnings.push(`Dynamic filtering unavailable (${e.message}); used basic web tools.`);
      toolMode = 'basic';
      research = await runServerToolTurn(researchBody(toolMode), api, { onProgress: opts.onProgress });
    } else throw e;
  }
  if (research.final.stop_reason === 'refusal') throw new ClaudeError('The research step was refused by the model.');
  const notesTruncated = research.final.stop_reason === 'max_tokens';
  if (notesTruncated) warnings.push('Research notes hit the length limit and may be cut off.');

  const notes = cleanNotes(extractText(research.responses));
  if (!notes.trim()) throw new ClaudeError('The research step returned no notes.');
  const activity = toolActivity(research.responses);
  if (activity.errors.length) warnings.push(`Some web lookups failed: ${[...new Set(activity.errors)].join(', ')}`);
  const seen = collectSources(research.responses);
  const urlsSeen = [...new Set([
    ...seen.map((s) => s.url),
    ...(intake.website ? [intake.website] : []),
    ...(intake.google_maps_url ? [intake.google_maps_url] : []),
    ...places.candidates.flatMap((c) => [c.website, c.google_maps_url]).filter(Boolean),
  ])];

  // 4. Extraction
  progress('extract', 'Building the business profile');
  const wire = toWireSchema(schema, { omit: CODE_FIELDS });
  const extractSystem = fillTemplate(extractorPrompt, {
    TODAY: opts.today,
    INDUSTRY_LIST: Object.entries(industryMap.industries).map(([id, v]) => `${id} (${v.label})`).join(', '),
    MODULE_LIST: modulesCfg.modules.map((m) => `- ${m.id}: ${m.summary}`).join('\n'),
  });
  const extractInput = JSON.stringify({
    intake,
    google_listing: places.candidates,
    brand_signals: brand.available ? brand : null,
    urls_seen: urlsSeen,
  }, null, 2);
  const extractMessages = [{
    role: 'user',
    content: `${extractInput}\n\n<research_notes>\n${notes}\n</research_notes>`,
  }];
  const extraction = await extractProfile({ model: opts.extractModel, system: extractSystem, messages: extractMessages, wire }, api, warnings);

  // 5. Code checks
  let profile = {
    schema_version: '1.0',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    research_meta: {
      research_model: opts.researchModel,
      extract_model: opts.extractModel,
      tool_mode: opts.mock ? 'mock' : toolMode,
      web_searches: activity.searches,
      web_fetches: activity.fetches,
      places_used: places.candidates.length > 0,
      brand_signals_used: !!brand.available,
      notes_truncated: notesTruncated,
    },
    owner_confirmed: { confirmed: false, confirmed_at: '', ownership_verified: false, verification_method: '' },
    ...extraction.data,
  };
  profile = applyEvidenceRules(profile, { urlsSeen, brand, places: places.candidates, intake });
  const { value, repairs } = sanitize(schema, profile);
  profile = ensureConfirmations(value, { placesUsed: places.candidates.length > 0 });
  const errors = validate(schema, profile);

  progress('done', errors.length ? 'Profile built with problems to review' : 'Profile ready for owner review');
  return {
    profile,
    notes,
    sources_seen: seen,
    google_listing: places.candidates,
    brand_signals: brand,
    validation: { valid: errors.length === 0, errors, repairs },
    warnings,
    usage: {
      research: sumUsage(research.responses),
      extract: sumUsage([extraction.response]),
      web_searches: activity.searches,
      web_fetches: activity.fetches,
    },
  };
}

function researchUserMessage(intake, candidates, website) {
  const lines = [
    'Research this business for its app.',
    '',
    '## Intake (S0)',
    `- Name: ${intake.name}`,
    `- Location: ${intake.location || 'not given'}`,
  ];
  if (intake.website) lines.push(`- Website: ${intake.website}`);
  if (intake.phone) lines.push(`- Phone: ${intake.phone}`);
  if (intake.google_maps_url) lines.push(`- Google Maps link: ${intake.google_maps_url}`);
  if (intake.notes) lines.push(`- Notes from the person setting this up: ${intake.notes}`);
  if (!intake.website && website) lines.push(`- Website from the Google listing: ${website}`);
  if (candidates.length) {
    lines.push('', '## Google listing data (S1)', 'Possible matches from Google Places, best first. Confirm which (if any) is this business.');
    candidates.forEach((c, i) => {
      lines.push(
        `${i + 1}. ${c.name} | ${c.formatted_address || 'no address'} | ${c.phone || 'no phone'} | ${c.website || 'no website'} | ${c.google_maps_url || ''}`,
        `   category: ${c.primary_type || c.types.slice(0, 3).join(', ') || 'unknown'}; status: ${c.business_status || 'unknown'}; rating: ${c.rating ?? 'none'} (${c.rating_count} reviews)`,
        `   hours: ${c.hours_text.length ? c.hours_text.join('; ') : 'not listed'}`,
      );
    });
  }
  lines.push('', 'Follow your instructions and finish with the research notes.');
  return lines.join('\n');
}

async function extractProfile({ model, system, messages, wire }, api, warnings) {
  const base = { model, max_tokens: 16000, system, messages };
  let response;
  try {
    response = await createMessage({ ...base, output_config: { format: { type: 'json_schema', schema: wire } } }, api);
  } catch (e) {
    if (!(e instanceof ClaudeError) || e.status !== 400) throw e;
    // Schema rejected (too complex, or a keyword the API won't take): ask for JSON in the prompt instead.
    warnings.push(`Structured output not accepted (${e.message}); used prompt-only JSON.`);
    response = await createMessage({
      ...base,
      system: `${system}\n\nRespond with only one JSON object, no other text, matching this JSON Schema:\n${JSON.stringify(wire)}`,
    }, api);
  }
  if (response.stop_reason === 'refusal') throw new ClaudeError('The profile step was refused by the model.');
  if (response.stop_reason === 'max_tokens') {
    warnings.push('Profile hit the length limit; retried with more room.');
    response = await createMessage({ ...base, max_tokens: 32000, output_config: { format: { type: 'json_schema', schema: wire } } }, api);
  }
  const text = extractText([response]);
  const data = parseJsonObject(text);
  if (!data) throw new ClaudeError('The profile step did not return valid JSON.');
  return { data, response };
}

export function parseJsonObject(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Keep the notes from their heading on; drops "Let me search..." chatter. */
export function cleanNotes(text) {
  const i = text.lastIndexOf('# Research notes');
  return (i >= 0 ? text.slice(i) : text).trim();
}

export function namesMatch(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|llc|inc|co)\b/g, '').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Deterministic rules applied after extraction:
 *  - sources must be URLs the tools actually saw (or the intake)
 *  - provenance can only point at sources that survived
 *  - website colors, logo and social links fill gaps from brand signals
 */
export function applyEvidenceRules(profile, { urlsSeen = [], brand = {}, places = [], intake = {} }) {
  const p = structuredClone(profile);
  const seen = new Set(urlsSeen.map(normUrl));
  const placesUrls = new Set(places.flatMap((c) => [c.google_maps_url, c.website]).filter(Boolean).map(normUrl));
  p.sources = (p.sources || []).filter((s) => s && (s.url === 'intake' || seen.has(normUrl(s.url)) || placesUrls.has(normUrl(s.url))));
  const ids = new Set(p.sources.map((s) => s.id));
  p.facts_provenance = (p.facts_provenance || []).map((f) => ({ ...f, source_ids: (f.source_ids || []).filter((id) => ids.has(id)) }));

  p.brand = p.brand || {};
  if (brand.available) {
    const fromCss = brand.colors?.brand || [];
    if (!p.brand.colors?.length && (fromCss.length || brand.theme_color)) {
      const theme = isSaturated(brand.theme_color) ? brand.theme_color : '';
      const hexes = [...new Set([theme, ...fromCss.map((c) => c.hex)].filter(Boolean))].slice(0, 3);
      const roles = ['primary', 'secondary', 'accent'];
      p.brand.colors = hexes.map((hex, i) => ({ hex, role: roles[i], basis: 'website_css' }));
    }
    if (!p.brand.logo_url) p.brand.logo_url = brand.logo || brand.icon || '';
    if (!p.brand.fonts_observed?.length && brand.fonts?.length) p.brand.fonts_observed = brand.fonts.slice(0, 4);
    const have = new Set((p.socials || []).map((s) => normUrl(s.url)));
    for (const link of brand.social_links || []) {
      if (!have.has(normUrl(link.url))) {
        (p.socials ||= []).push({ platform: link.platform, url: link.url, handle: handleFrom(link.url) });
        have.add(normUrl(link.url));
      }
    }
  }
  // Never let a website URL the tools didn't see stand in the profile.
  if (p.contact?.website && !seen.has(normUrl(p.contact.website)) && !placesUrls.has(normUrl(p.contact.website)) && normUrl(p.contact.website) !== normUrl(intake.website || '')) {
    const host = hostOf(p.contact.website);
    const hostSeen = host && [...seen].some((u) => hostOf(u) === host);
    if (!hostSeen) p.contact.website = '';
  }
  return p;
}

function isSaturated(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return false;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return s > 0.25 && l > 0.12 && l < 0.92;
}

const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
const hostOf = (u) => normUrl(u).split('/')[0];
const handleFrom = (url) => {
  const m = String(url).match(/\.com\/(@?[A-Za-z0-9_.-]+)/);
  return m ? m[1] : '';
};
