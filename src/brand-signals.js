// Reads a business website's HTML and CSS for brand clues: colors, fonts,
// logo, theme color, social links. Web fetch through Claude returns page text
// only, so colors come from here.
//
// Works in Node (CLI, desktop app, CI). In a browser, most sites block
// cross-origin reads, so this returns { available: false } and research
// carries on without it.

const MAX_HTML = 1_500_000;
const MAX_CSS = 500_000;
const MAX_STYLESHEETS = 4;

/**
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export async function extractBrandSignals(url, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (!url) return { available: false, reason: 'no website' };
  let pageUrl;
  try { pageUrl = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); }
  catch { return { available: false, reason: 'bad website URL' }; }

  const html = await getText(pageUrl.href, { fetchImpl, timeoutMs, max: MAX_HTML });
  if (!html.ok) return { available: false, reason: html.error };

  const doc = html.text;
  const base = html.finalUrl || pageUrl.href;
  const sheets = [...doc.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel=["']?[^"'>]*stylesheet/i.test(tag))
    .map((tag) => attr(tag, 'href'))
    .filter(Boolean)
    .map((href) => resolve(href, base))
    .filter((u) => u && !/fonts\.googleapis\.com/i.test(u))
    .slice(0, MAX_STYLESHEETS);

  const css = [
    ...[...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
    ...[...doc.matchAll(/\bstyle=["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  for (const sheet of sheets) {
    const r = await getText(sheet, { fetchImpl, timeoutMs, max: MAX_CSS });
    if (r.ok) css.push(r.text);
  }

  return {
    available: true,
    url: base,
    theme_color: normalizeHex(meta(doc, 'theme-color')) || '',
    site_name: meta(doc, 'og:site_name') || titleOf(doc),
    description: meta(doc, 'description') || meta(doc, 'og:description') || '',
    og_image: resolve(meta(doc, 'og:image'), base) || '',
    icon: findIcon(doc, base),
    logo: findLogo(doc, base),
    colors: rankColors(css.join('\n')),
    fonts: findFonts(doc, css.join('\n')),
    social_links: findSocialLinks(doc, base),
    platform: detectPlatform(doc),
    stylesheets_read: sheets.length,
  };
}

async function getText(url, { fetchImpl, timeoutMs, max }) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: ctrl?.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AppForgeResearch/1.0)', accept: 'text/html,text/css,*/*' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = (await res.text()).slice(0, max);
    return { ok: true, text, finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : '';
};
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

function meta(doc, key) {
  for (const m of doc.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    if (k === key) return attr(tag, 'content');
  }
  return '';
}

const titleOf = (doc) => decode((doc.match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || '');

function resolve(href, base) {
  if (!href || /^(data:|javascript:|mailto:|tel:)/i.test(href)) return '';
  try { return new URL(href, base).href; } catch { return ''; }
}

function findIcon(doc, base) {
  const links = [...doc.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const pick = (re) => links.find((t) => re.test(attr(t, 'rel')));
  const tag = pick(/apple-touch-icon/i) || pick(/\bicon\b/i);
  return tag ? resolve(attr(tag, 'href'), base) : '';
}

function findLogo(doc, base) {
  for (const m of doc.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const hay = `${attr(tag, 'src')} ${attr(tag, 'alt')} ${attr(tag, 'class')} ${attr(tag, 'id')}`.toLowerCase();
    if (hay.includes('logo')) return resolve(attr(tag, 'src') || attr(tag, 'data-src'), base);
  }
  return '';
}

const SOCIAL = {
  facebook: /facebook\.com\//i,
  instagram: /instagram\.com\//i,
  tiktok: /tiktok\.com\/@/i,
  youtube: /youtube\.com\/|youtu\.be\//i,
  x: /(twitter|x)\.com\//i,
  linkedin: /linkedin\.com\//i,
  pinterest: /pinterest\.com\//i,
  yelp: /yelp\.com\/biz\//i,
  nextdoor: /nextdoor\.com\//i,
};

function findSocialLinks(doc, base) {
  const found = {};
  for (const m of doc.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = resolve(decode(m[1]), base);
    for (const [platform, re] of Object.entries(SOCIAL)) {
      if (!found[platform] && re.test(href) && !/sharer|share\?|intent\/tweet|\/plugins\//i.test(href)) found[platform] = href;
    }
  }
  return Object.entries(found).map(([platform, url]) => ({ platform, url }));
}

function detectPlatform(doc) {
  const checks = [
    ['wix', /wix\.com|_wixCIDX|wixstatic/i],
    ['squarespace', /squarespace/i],
    ['square_online', /square\.site|editmysite|weebly/i],
    ['shopify', /cdn\.shopify|shopify\.com/i],
    ['wordpress', /wp-content|wp-includes/i],
    ['godaddy', /godaddy|img1\.wsimg/i],
    ['webflow', /webflow/i],
  ];
  const hit = checks.find(([, re]) => re.test(doc));
  return hit ? hit[0] : 'unknown';
}

export function normalizeHex(value) {
  const s = String(value || '').trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return '#' + m[1];
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
  return '';
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Saturation 0-1 and lightness 0-1. */
function hsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

/**
 * Counts colors in CSS and splits them into brand colors (saturated) and
 * neutrals. Colors used in many rules rank higher; near-duplicates merge.
 */
export function rankColors(css) {
  const counts = new Map();
  const re = /#(?:[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|[0-9a-fA-F]{3})\b|rgba?\([^)]+\)/g;
  for (const m of css.matchAll(re)) {
    if (/rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(m[0])) continue; // fully transparent
    const hex = normalizeHex(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const merged = [];
  for (const [hex, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const near = merged.find((c) => distance(c.hex, hex) < 18);
    if (near) near.count += count;
    else merged.push({ hex, count });
  }
  const brand = [];
  const neutrals = [];
  for (const c of merged) {
    const { s, l } = hsl(c.hex);
    (s > 0.25 && l > 0.12 && l < 0.92 ? brand : neutrals).push(c);
  }
  return { brand: brand.slice(0, 6), neutrals: neutrals.slice(0, 4) };
}

function distance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

const GENERIC_FONTS = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica', 'helvetica neue', 'arial', 'emoji', 'apple color emoji', 'segoe ui emoji', 'var']);

function findFonts(doc, css) {
  const found = [];
  const add = (f) => {
    const name = f.replace(/["']/g, '').replace(/\+/g, ' ').trim();
    if (name && !GENERIC_FONTS.has(name.toLowerCase()) && !name.startsWith('var(') && !found.includes(name)) found.push(name);
  };
  for (const m of doc.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>\s]+)/gi)) {
    for (const fam of decode(m[1]).matchAll(/family=([^:&]+)/g)) add(decodeURIComponent(fam[1]));
  }
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    add(m[1].split(',')[0]);
  }
  return found.slice(0, 4);
}
