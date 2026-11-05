// The owner review step: which questions to ask, how to apply the answers,
// and how ownership gets verified before an app is built.

import { getPath, setPath } from './schema-tools.js';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/**
 * Adds the questions that must always be asked, whatever the model chose.
 * Never removes the model's own questions. Dedupes by field.
 */
export function ensureConfirmations(profile, { placesUsed = false } = {}) {
  const p = structuredClone(profile);
  const list = Array.isArray(p.needs_confirmation) ? p.needs_confirmation : [];
  const has = (field) => list.some((q) => q.field === field);
  const add = (q) => { if (!has(q.field) && list.length < 25) list.push(q); };
  const prov = (field) => (p.facts_provenance || []).find((f) => f.field === field);

  if (p.confidence?.identity_match !== 'confirmed') {
    const where = [p.contact?.address?.street, p.contact?.address?.city, p.contact?.address?.region].filter(Boolean).join(', ');
    add({ field: 'business.name', question: `Is this your business: ${p.business?.name || 'unknown'}${where ? ` at ${where}` : ''}?`, current_value: p.business?.name || '', reason: 'unverified' });
  }
  if (p.business?.status && p.business.status !== 'operating') {
    add({ field: 'business.status', question: 'Research shows the business may not be open right now. Is it currently operating?', current_value: p.business.status, reason: 'unverified' });
  }

  const needsHours = !['online_only'].includes(p.business?.business_model);
  if (needsHours && !p.hours?.known) {
    add({ field: 'hours', question: 'What are your regular hours? (for example: Mon-Fri 7am-2pm, Sat 8am-noon)', current_value: '', reason: 'missing' });
  } else if (p.hours?.known && ['google_listing', 'directory', 'review_site', 'inferred'].includes(p.hours.basis)) {
    add({ field: 'hours', question: 'Are these your current hours?', current_value: formatHours(p.hours.weekly), reason: 'unverified' });
  }

  if (!p.contact?.phone && !p.contact?.email) {
    add({ field: 'contact.phone', question: 'What phone number should customers use?', current_value: '', reason: 'missing' });
  } else if (p.contact?.phone && placesUsed && prov('contact.phone')?.basis === 'google_listing') {
    add({ field: 'contact.phone', question: 'Is this the best number for customers to call or text?', current_value: p.contact.phone, reason: 'unverified' });
  }

  if (p.contact?.address_is_public && p.contact?.address?.street && ['google_listing', 'directory', 'inferred'].includes(prov('contact.address')?.basis)) {
    const a = p.contact.address;
    add({ field: 'contact.address', question: 'Is this the address customers should come to?', current_value: [a.street, a.city, a.region, a.postal_code].filter(Boolean).join(', '), reason: 'unverified' });
  }

  const offerCount = (p.offerings?.categories || []).reduce((n, c) => n + (c.items || []).length, 0);
  if (p.offerings?.kind === 'unknown' || offerCount === 0) {
    add({ field: 'offerings', question: 'What do you sell or offer? A menu, price list or link works.', current_value: '', reason: 'missing' });
  }

  const colors = p.brand?.colors || [];
  if (!colors.length || colors.some((c) => c.basis === 'inferred')) {
    add({ field: 'brand.colors', question: colors.length ? 'Are these your brand colors?' : 'What are your brand colors? (or upload your logo)', current_value: colors.map((c) => `${c.role} ${c.hex}`).join(', '), reason: colors.length ? 'inferred' : 'missing' });
  }

  p.needs_confirmation = list;
  return p;
}

/** Shapes the questions for a review screen: adds an input type and the label. */
export function buildReview(profile) {
  const inputFor = (field) => {
    if (field === 'business.name' || field === 'business.status') return 'yes_no';
    if (field === 'hours' || field === 'hours.weekly') return 'hours';
    if (field === 'brand.colors') return 'colors';
    if (field === 'offerings') return 'long_text';
    return 'text';
  };
  return {
    business: profile.business?.name || '',
    identity: profile.confidence?.identity_match || 'uncertain',
    questions: (profile.needs_confirmation || []).map((q, i) => ({ id: `q${i + 1}`, ...q, input: inputFor(q.field) })),
    ownership: verificationOptions(profile),
  };
}

/**
 * Applies the owner's answers.
 * @param {object} profile
 * @param {Array<{ field: string, accepted?: boolean, value?: any }>} answers
 *   accepted: true keeps what research found; a value replaces it.
 *   For yes/no questions, value false (or "no") means "that's not right".
 * @returns {{ profile: object, identityRejected: boolean, remaining: object[] }}
 */
export function applyOwnerAnswers(profile, answers = [], { now = new Date() } = {}) {
  const p = structuredClone(profile);
  let identityRejected = false;
  const answered = new Set();

  for (const a of answers) {
    if (!a || !a.field) continue;
    const isYesNo = a.field === 'business.name' || a.field === 'business.status';
    const no = a.value === false || /^(no|nope|n)$/i.test(String(a.value ?? '').trim());

    if (isYesNo) {
      if (a.field === 'business.name' && (no || a.accepted === false)) identityRejected = true;
      if (a.field === 'business.status' && !no && a.accepted !== false) p.business.status = 'operating';
      if (a.field === 'business.name' && !identityRejected) p.confidence.identity_match = 'confirmed';
    } else if (a.value !== undefined && a.value !== null && String(a.value).trim() !== '' && !(typeof a.value === 'boolean')) {
      applyValue(p, a.field, a.value);
    } else if (a.accepted !== true) {
      continue; // skipped
    }
    markOwnerProvenance(p, a.field);
    answered.add(a.field);
  }

  p.needs_confirmation = (p.needs_confirmation || []).filter((q) => !answered.has(q.field));
  if (identityRejected) {
    p.confidence.identity_match = 'uncertain';
    p.owner_confirmed.confirmed = false;
  } else if (p.needs_confirmation.length === 0) {
    p.owner_confirmed.confirmed = true;
    p.owner_confirmed.confirmed_at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return { profile: p, identityRejected, remaining: p.needs_confirmation };
}

function applyValue(p, field, value) {
  if (field === 'hours' || field === 'hours.weekly') {
    const weekly = Array.isArray(value) ? value : parseHoursText(String(value));
    p.hours.weekly = weekly;
    p.hours.known = weekly.length > 0;
    p.hours.basis = 'owner';
    if (!Array.isArray(value) && /appointment/i.test(value)) p.hours.notes = [p.hours.notes, 'By appointment'].filter(Boolean).join('. ');
    return;
  }
  if (field === 'brand.colors') {
    const hexes = Array.isArray(value) ? value : String(value).match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || [];
    const roles = ['primary', 'secondary', 'accent', 'background', 'text'];
    if (hexes.length) {
      p.brand.colors = hexes.slice(0, 5).map((h, i) => {
        const hex = typeof h === 'string' && h.length === 4 ? '#' + h.slice(1).split('').map((c) => c + c).join('') : (h.hex || h);
        return { hex: hex.toLowerCase(), role: h.role || roles[i], basis: 'logo' };
      });
    }
    return;
  }
  if (field === 'offerings') {
    // Free text from the owner: one item per line, "Name - $price" optional.
    if (Array.isArray(value)) { p.offerings.categories = value; return; }
    const items = String(value).split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(.*?)(?:\s*[-–:]\s*|\s+)(\$\s?\d[\d.,]*(?:\s*[-–]\s*\$?\s?\d[\d.,]*)?)$/);
      return m ? { name: m[1].trim().slice(0, 100), description: '', price: m[2].replace(/\s+/g, '') } : { name: line.slice(0, 100), description: '', price: '' };
    });
    if (items.length) {
      p.offerings.categories = [{ name: 'Offerings', items: items.slice(0, 60) }];
      if (p.offerings.kind === 'unknown') p.offerings.kind = 'mixed';
    }
    return;
  }
  const current = getPath(p, field);
  if (current && typeof current === 'object' && !Array.isArray(current) && field === 'contact.address') {
    const parts = String(value).split(',').map((s) => s.trim());
    const [street = '', city = '', regionZip = ''] = parts;
    const m = regionZip.match(/^([A-Za-z .]+?)\s*(\d{5}(-\d{4})?)?$/);
    setPath(p, 'contact.address', { ...current, street, city, region: m ? m[1].trim() : regionZip, postal_code: m?.[2] || current.postal_code || '' });
    p.contact.address_is_public = Boolean(street);
    return;
  }
  setPath(p, field, typeof current === 'number' ? Number(value) : value);
}

function markOwnerProvenance(p, field) {
  const key = field === 'hours.weekly' ? 'hours' : field;
  const list = (p.facts_provenance ||= []);
  const entry = list.find((f) => f.field === key);
  if (!p.sources?.some((s) => s.id === 'S0')) (p.sources ||= []).unshift({ id: 'S0', url: 'intake', title: 'Owner review', kind: 'owner' });
  if (entry) { entry.basis = 'owner'; entry.source_ids = ['S0']; }
  else if (list.length < 20) list.push({ field: key, source_ids: ['S0'], basis: 'owner' });
}

/** Ways the owner can prove the business is theirs, best first. */
export function verificationOptions(profile) {
  const opts = [];
  const site = hostOf(profile.contact?.website);
  const emailDomain = String(profile.contact?.email || '').split('@')[1]?.toLowerCase() || '';
  if (profile.contact?.phone) opts.push({ method: 'code_to_listed_phone', label: `Text or call a code to the listed number ${profile.contact.phone}` });
  if (emailDomain && site && (site === emailDomain || site.endsWith(`.${emailDomain}`))) {
    opts.push({ method: 'code_to_domain_email', label: `Email a code to ${profile.contact.email}` });
  }
  opts.push({ method: 'google_business_profile', label: 'Add AppForge as a manager on the Google Business Profile' });
  opts.push({ method: 'in_person', label: 'Verified in person or by a signed agreement' });
  return opts;
}

export function markOwnershipVerified(profile, method) {
  const p = structuredClone(profile);
  p.owner_confirmed.ownership_verified = true;
  p.owner_confirmed.verification_method = String(method).slice(0, 80);
  return p;
}

const hostOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];

// ---------------------------------------------------------------------------
// Hours text <-> weekly entries
// ---------------------------------------------------------------------------

/** "Mon-Fri 07:00-14:00, Sat 08:00-12:00" */
export function formatHours(weekly = []) {
  const byDay = Object.fromEntries(DAY_ORDER.map((d) => [d, []]));
  for (const e of weekly) if (byDay[e.day]) byDay[e.day].push(`${e.open}-${e.close}`);
  const groups = [];
  for (const d of DAY_ORDER) {
    const spans = byDay[d].join(' & ');
    if (!spans) continue;
    const last = groups[groups.length - 1];
    if (last && last.spans === spans && DAY_ORDER.indexOf(d) === DAY_ORDER.indexOf(last.end) + 1) last.end = d;
    else groups.push({ start: d, end: d, spans });
  }
  return groups
    .map((g) => `${DAY_LABEL[g.start]}${g.end !== g.start ? `-${DAY_LABEL[g.end]}` : ''} ${g.spans}`)
    .join(', ');
}

const DAY_ALIASES = {
  mon: 'mon', monday: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue', wed: 'wed', weds: 'wed', wednesday: 'wed',
  thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat', sun: 'sun', sunday: 'sun',
};

function parseDays(text) {
  const t = text.toLowerCase().trim();
  if (/^(daily|every ?day|7 days( a week)?|all week)$/.test(t)) return [...DAY_ORDER];
  if (/^weekdays?$/.test(t)) return DAY_ORDER.slice(0, 5);
  if (/^weekends?$/.test(t)) return ['sat', 'sun'];
  const days = new Set();
  for (const part of t.split(/\s*(?:,|&|\/|\band\b)\s*/)) {
    const range = part.match(/^([a-z]+)\.?\s*(?:-|–|to|thru|through)\s*([a-z]+)\.?$/);
    if (range) {
      const a = DAY_ALIASES[range[1]];
      const b = DAY_ALIASES[range[2]];
      if (!a || !b) continue;
      let i = DAY_ORDER.indexOf(a);
      for (let n = 0; n < 7; n++) {
        days.add(DAY_ORDER[i]);
        if (DAY_ORDER[i] === b) break;
        i = (i + 1) % 7;
      }
    } else {
      const d = DAY_ALIASES[part.replace(/\.$/, '')];
      if (d) days.add(d);
    }
  }
  return DAY_ORDER.filter((d) => days.has(d));
}

function parseTime(raw, hintPm = null) {
  const t = raw.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const mer = m[3] ? m[3][0] : hintPm;
  if (mer === 'p' && h < 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseSpan(span) {
  const parts = span.split(/\s*(?:-|–|to)\s*/);
  if (parts.length !== 2) return null;
  const endMer = (parts[1].toLowerCase().match(/(am|pm|a|p)\s*$/) || [])[1]?.[0] || null;
  const close = parseTime(parts[1]);
  // "7-2pm": a start without am/pm borrows from the end, unless that would put it after the end.
  let open = parseTime(parts[0]);
  if (open && !/(am|pm|a|p)\s*$/i.test(parts[0]) && endMer) {
    const asEnd = parseTime(parts[0], endMer);
    open = asEnd && close && asEnd < close ? asEnd : parseTime(parts[0], 'a');
  }
  if (!open || !close) return null;
  // "9-5" with no am/pm anywhere means 9am-5pm, not 9am-5am.
  const noMeridiem = !/(am|pm|a|p)\s*$/i.test(parts[0]) && !endMer && !/noon|midnight/i.test(span);
  if (noMeridiem && close <= open && Number(close.slice(0, 2)) < 12) {
    return { open, close: `${String(Number(close.slice(0, 2)) + 12).padStart(2, '0')}${close.slice(2)}`, guessed: true };
  }
  return { open, close, guessed: noMeridiem };
}

// "11-2 & 5-9": a later span that starts before the earlier one ends is in the afternoon.
function shiftLaterSpans(spans) {
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const s = spans[i];
    if (s.guessed && s.open < prev.close) {
      const bump = (t) => (Number(t.slice(0, 2)) < 12 ? `${String(Number(t.slice(0, 2)) + 12).padStart(2, '0')}${t.slice(2)}` : t);
      s.open = bump(s.open);
      if (s.close < s.open) s.close = bump(s.close);
    }
  }
  return spans.map(({ open, close }) => ({ open, close }));
}

const DAY_RE = '(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?';
const DAY_SEP = '\\s*(?:-|–|to|thru|through|,|&|and|\\/)\\s*';
const DAYS_RE = `(?:daily|every\\s?day|7 days(?: a week)?|weekdays?|weekends?|${DAY_RE}(?:${DAY_SEP}${DAY_RE})*)`;
const TIME_RE = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.|a|p)?\\b|noon|midnight)';
const SPAN_RE = `${TIME_RE}\\s*(?:-|–|to)\\s*${TIME_RE}`;
const SPANS_RE = `(?:closed|${SPAN_RE}(?:\\s*(?:&|,|and)\\s*${SPAN_RE})*)`;

/** Parses owner-typed hours such as "Mon-Fri 7am-2pm, Sat 8-12; Sun closed". */
export function parseHoursText(text) {
  const out = [];
  const pair = new RegExp(`(${DAYS_RE})\\s*:?\\s*(${SPANS_RE})`, 'gi');
  for (const m of String(text).matchAll(pair)) {
    const days = parseDays(m[1]);
    if (!days.length || /^closed/i.test(m[2])) continue;
    const spans = shiftLaterSpans(m[2].split(/\s*(?:&|,|\band\b)\s*/).map(parseSpan).filter(Boolean));
    for (const d of days) for (const s of spans) out.push({ day: d, ...s });
  }
  const seen = new Set();
  return out
    .filter((e) => { const k = `${e.day}${e.open}${e.close}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.open.localeCompare(b.open));
}
