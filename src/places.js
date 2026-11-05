// Optional Google Places (New) lookup. Used to pin down which business we mean
// and to hand the research agent its website and Maps link.
//
// Google's terms limit storing Places content, so everything that comes from
// here is treated as a lead: the research step re-checks it, and any value that
// only Google supplied goes to the owner to confirm. The owner's confirmation is
// what ends up in the app.

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.regularOpeningHours',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  'places.rating',
  'places.userRatingCount',
].join(',');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n ?? 0).padStart(2, '0');

/**
 * @param {{ name: string, location?: string }} intake
 * @param {{ apiKey: string, fetchImpl?: typeof fetch, maxResults?: number }} opts
 * @returns {Promise<{ ok: boolean, candidates: object[], error?: string }>}
 */
export async function lookupPlace(intake, { apiKey, fetchImpl = globalThis.fetch, maxResults = 3 } = {}) {
  if (!apiKey) return { ok: false, candidates: [], error: 'no Google Places key' };
  const textQuery = [intake.name, intake.location].filter(Boolean).join(', ');
  try {
    const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery, pageSize: maxResults }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, candidates: [], error: data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, candidates: (data.places || []).slice(0, maxResults).map(simplifyPlace) };
  } catch (e) {
    return { ok: false, candidates: [], error: e.message };
  }
}

export function simplifyPlace(p) {
  const comp = (type, short = false) => {
    const c = (p.addressComponents || []).find((a) => (a.types || []).includes(type));
    return c ? (short ? c.shortText : c.longText) || '' : '';
  };
  const street = [comp('street_number'), comp('route')].filter(Boolean).join(' ');
  return {
    place_id: p.id || '',
    name: p.displayName?.text || '',
    formatted_address: p.formattedAddress || '',
    address: {
      street,
      city: comp('locality') || comp('postal_town') || comp('sublocality'),
      region: comp('administrative_area_level_1', true),
      postal_code: comp('postal_code'),
      country: comp('country', true),
    },
    phone: p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
    google_maps_url: p.googleMapsUri || '',
    primary_type: p.primaryType || '',
    types: p.types || [],
    business_status: p.businessStatus || '',
    rating: typeof p.rating === 'number' ? p.rating : null,
    rating_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    hours_text: p.regularOpeningHours?.weekdayDescriptions || [],
    hours: periodsToWeekly(p.regularOpeningHours?.periods || []),
  };
}

/** Converts Places periods (day 0 = Sunday) to the profile's weekly entries. */
export function periodsToWeekly(periods) {
  const out = [];
  for (const per of periods) {
    if (!per.open) continue;
    // Open 24 hours is a single period with no close.
    if (!per.close) {
      for (const d of DAYS) out.push({ day: d, open: '00:00', close: '23:59' });
      continue;
    }
    out.push({
      day: DAYS[per.open.day] || 'mon',
      open: `${pad(per.open.hour)}:${pad(per.open.minute)}`,
      close: `${pad(per.close.hour)}:${pad(per.close.minute)}`,
    });
  }
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return out.sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day) || a.open.localeCompare(b.open));
}
