// Loads the repo's prompt, schema and config files in Node and in the browser.
// In the browser, files are fetched relative to this module, so serve the repo
// root (or copy src/, prompts/, schema/ and config/ side by side).

export const IS_NODE =
  typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

const cache = new Map();

export async function loadText(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const url = new URL(`../${relPath}`, import.meta.url);
  let text;
  if (IS_NODE) {
    const { readFile } = await import('node:fs/promises');
    text = await readFile(url, 'utf8');
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${relPath} (${res.status})`);
    text = await res.text();
  }
  cache.set(relPath, text);
  return text;
}

export async function loadJson(relPath) {
  return JSON.parse(await loadText(relPath));
}

export const loadProfileSchema = () => loadJson('schema/business-profile.schema.json');
export const loadModules = () => loadJson('config/modules.json');
export const loadIndustryMap = () => loadJson('config/industry-map.json');
export const loadPrompt = (name) => loadText(`prompts/${name}.md`);

/** Replace {{KEY}} placeholders. Unknown keys are left in place so tests catch them. */
export function fillTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m,
  );
}

export function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '') || 'business';
}
