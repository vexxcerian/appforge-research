// Builds what AppForge's generator needs for a researched business:
//   - prompt: the build brief, pasted into (or sent by) the AppForge builder
//   - manifest: apps/<slug>/app.json in AppForge's format
//   - businessData: the facts the app renders, embedded verbatim in the HTML

import { loadModules, slugify } from './assets.js';

export async function buildAppBrief(profile, plan, options = {}) {
  const modulesCfg = await loadModules();
  return buildAppBriefWith(profile, plan, { modulesCfg, ...options });
}

export function buildAppBriefWith(profile, plan, { modulesCfg, appIdPrefix = 'com.appforge', slug } = {}) {
  if (plan.blocked) {
    throw new Error(`Can't build yet: ${plan.blockers.join(' ')}`);
  }
  const library = new Map(modulesCfg.modules.map((m) => [m.id, m]));
  const b = profile.business;
  const appSlug = slug || slugify(b.name);
  const palette = paletteFor(profile.brand);

  const manifest = {
    name: b.name.slice(0, 50),
    slug: appSlug,
    appId: toAppId(appIdPrefix, appSlug),
    versionName: '1.0.0',
    versionCode: 1,
    themeColor: palette.primary,
    backgroundColor: palette.background,
    targets: { web: true, android: true, ios: true },
    generator: 'appforge',
    research: {
      profile_generated_at: profile.generated_at,
      owner_confirmed_at: profile.owner_confirmed?.confirmed_at || '',
      modules: plan.modules.map((m) => m.id),
    },
  };

  const businessData = toBusinessData(profile, plan);
  const prompt = renderPrompt({ profile, plan, library, palette, businessData });
  return { slug: appSlug, manifest, businessData, prompt };
}

export function toAppId(prefix, slug) {
  const clean = String(prefix || 'com.appforge').toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || 'com.appforge';
  let last = slug.replace(/-/g, '').replace(/[^a-z0-9_]/g, '') || 'app';
  if (/^\d/.test(last)) last = `a${last}`;
  return `${clean}.${last.slice(0, 40)}`;
}

/** Picks primary/secondary/accent/background/text with sensible fallbacks. */
export function paletteFor(brand = {}) {
  const byRole = Object.fromEntries((brand.colors || []).map((c) => [c.role, c.hex.toLowerCase()]));
  const list = (brand.colors || []).map((c) => c.hex.toLowerCase());
  const primary = byRole.primary || list[0] || '#2563eb';
  const background = byRole.background || '#ffffff';
  const text = byRole.text || (luminance(background) > 0.5 ? '#111827' : '#f8fafc');
  return {
    primary,
    secondary: byRole.secondary || list.find((h) => h !== primary) || primary,
    accent: byRole.accent || byRole.secondary || primary,
    background,
    text,
    on_primary: luminance(primary) > 0.55 ? '#111827' : '#ffffff',
  };
}

function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Only what the app shows customers. Sources, competitors and complaints stay out. */
export function toBusinessData(p, plan) {
  return {
    name: p.business.name,
    tagline: p.business.tagline,
    description: p.business.description,
    industry: p.business.industry,
    year_founded: p.business.year_founded,
    contact: {
      phone: p.contact.phone,
      email: p.contact.email,
      website: p.contact.website,
      address: p.contact.address_is_public ? p.contact.address : { street: '', city: p.contact.address.city, region: p.contact.address.region, postal_code: '', country: p.contact.address.country },
      address_is_public: p.contact.address_is_public,
      service_area: p.contact.service_area,
      maps_url: p.contact.address_is_public ? p.contact.google_maps_url : '',
    },
    hours: { known: p.hours.known, weekly: p.hours.weekly, notes: p.hours.notes },
    offerings: p.offerings,
    differentiators: p.differentiators,
    existing_tools: p.existing_tools.filter((t) => t.url),
    socials: p.socials,
    reviews: p.reputation.has_reviews ? { rating: p.reputation.rating, count: p.reputation.review_count, source: p.reputation.rating_source } : null,
    brand: { logo_url: p.brand.logo_url, fonts: p.brand.fonts_observed, tone: p.brand.tone },
    specials: [],
    faq: [],
    team: [],
    gallery: [],
    events: [],
    modules: plan.modules.map((m) => ({ id: m.id, mode: m.mode, tool_url: m.tool?.url || '' })),
  };
}

const TONE_WORDS = {
  friendly_casual: 'friendly and casual',
  warm_family: 'warm, family-run, welcoming',
  professional: 'clean, calm and professional',
  luxury_elegant: 'elegant and upscale, generous whitespace',
  bold_energetic: 'bold, high-energy, punchy headings',
  rustic_homemade: 'homemade and rustic, soft textures',
  playful: 'playful and fun, rounded shapes',
  faith_community: 'welcoming community feel, warm and hopeful',
  technical: 'precise and technical, confident',
};

/** Keeps only the part of a two-mode spec ("Native mode: … Deep-link mode: …") that applies. */
export function specFor(spec, mode) {
  const m = spec.match(/^(.*?)Native mode:\s*(.*?)\s*Deep-link mode:\s*(.*)$/s);
  if (!m) return spec;
  const part = mode === 'deep_link' ? m[3] : m[2];
  return `${m[1]}${part.charAt(0).toUpperCase()}${part.slice(1)}`.trim();
}

function renderPrompt({ profile: p, plan, library, palette, businessData }) {
  const where = [p.contact.address.city, p.contact.address.region].filter(Boolean).join(', ');
  const kind = p.business.subcategory || plan.industry_label.toLowerCase();
  const tabName = (id) => (id === 'more' ? 'More' : library.get(id)?.name || id);
  const font = p.brand.fonts_observed?.[0];

  const screens = plan.modules.map((m) => {
    const def = library.get(m.id);
    const lines = [`### ${def.name} (\`${m.id}\`)`, specFor(def.build_spec, m.mode)];
    if (m.mode === 'deep_link') lines.push(`Mode: deep link. The business already uses ${m.tool.provider || 'an existing tool'}; the main action opens ${m.tool.url}. Do not rebuild that system.`);
    if (!m.data_ready) lines.push(`Content still missing: ${m.missing.join(', ')}. Render a tidy "coming soon" state for customers, and mark the spot with data-owner-todo="${m.id}".`);
    return lines.join('\n');
  }).join('\n\n');

  return `Build a mobile app for **${p.business.name}**, a ${kind}${where ? ` in ${where}` : ''}.

This is a real business and its owner has reviewed the facts below. The app is for their customers. Every fact in the app (names, prices, hours, phone numbers, links) must come from BUSINESS_DATA; do not invent menu items, prices, reviews, team members, awards or history. Where content is missing, follow each screen's "Content still missing" note.

## Output
- One self-contained \`index.html\`: inline CSS and JS, no frameworks, no external requests except ${font ? `Google Fonts for "${font}", ` : ''}links the user taps (tel:, sms:, mailto:, maps and the business's own tool links).
- Embed BUSINESS_DATA exactly as given in \`<script type="application/json" id="business-data">\` and render every screen from it, so the owner can update content later by editing that block alone.
- Mobile-first (360-430px wide), safe-area insets, 44px minimum tap targets, WCAG AA contrast, respects prefers-reduced-motion, works offline once loaded.
- No payments, accounts or collection of sensitive personal data. Forms send pre-filled SMS or email to the business, or open the business's existing tool.

## Look and feel
- Tone: ${TONE_WORDS[p.brand.tone] || 'friendly and clear'}.${p.brand.voice_notes ? ` Voice: ${p.brand.voice_notes}` : ''}
- Colors: primary ${palette.primary}, secondary ${palette.secondary}, accent ${palette.accent}, background ${palette.background}, text ${palette.text}, text on primary ${palette.on_primary}. Put them in CSS custom properties.${font ? `\n- Headings in "${font}" with a system-font fallback; body in the system font stack.` : '\n- System font stack.'}${p.brand.logo_url ? `\n- Logo: ${p.brand.logo_url} (show the business name in the heading font if it fails to load).` : '\n- No logo yet: set the business name as a wordmark in the heading font.'}${p.brand.imagery_notes ? `\n- Imagery: ${p.brand.imagery_notes}` : ''}

## Navigation
- Bottom tab bar: ${plan.navigation.tabs.map(tabName).join(', ')}.${plan.navigation.more.length ? `\n- "More" opens a sheet listing: ${plan.navigation.more.map(tabName).join(', ')}.` : ''}
- Home quick actions, in this order: ${plan.quick_actions.map((a) => a.label).join(', ') || 'Call'}.

## Screens
${screens}

## BUSINESS_DATA
\`\`\`json
${JSON.stringify(businessData, null, 2)}
\`\`\`
`;
}
