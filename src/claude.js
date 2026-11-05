// Minimal Claude Messages API client: no SDK, works in Node 18+ and browsers.

export const CLAUDE_DEFAULTS = {
  baseUrl: 'https://api.anthropic.com',
  apiVersion: '2026-10-21',
  researchModel: 'claude-sonnet-5-5',
  extractModel: 'claude-sonnet-5-5',
};

export class ClaudeError extends Error {
  constructor(message, { status, type, body } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
    this.type = type;
    this.body = body;
  }
}

const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * POST /v1/messages.
 * @param {object} body Messages API request body
 * @param {{ apiKey: string, baseUrl?: string, apiVersion?: string, fetchImpl?: typeof fetch, signal?: AbortSignal }} opts
 */
export async function createMessage(body, opts) {
  const { apiKey, baseUrl = CLAUDE_DEFAULTS.baseUrl, apiVersion = CLAUDE_DEFAULTS.apiVersion, signal } = opts;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!apiKey) throw new ClaudeError('Missing Anthropic API key.');
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': apiVersion,
  };
  // Lets a PWA call the API straight from the phone, like the AppForge builder does.
  if (inBrowser()) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  let res;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new ClaudeError(`Could not reach the Claude API: ${e.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 300) || res.statusText;
    throw new ClaudeError(`Claude API ${res.status}: ${msg}`, { status: res.status, type: data?.error?.type, body: data });
  }
  if (!data) throw new ClaudeError('Claude API returned a response that was not JSON.');
  return data;
}

/**
 * Runs one turn that may use server tools (web search, web fetch), continuing
 * through pause_turn. Each paused response is kept, in order, as its own
 * assistant message; no user message is added between them.
 */
export async function runServerToolTurn(body, opts, { maxContinuations = 6, onProgress } = {}) {
  const messages = [...body.messages];
  const responses = [];
  for (let i = 0; i <= maxContinuations; i++) {
    const res = await createMessage({ ...body, messages }, opts);
    responses.push(res);
    onProgress?.({ step: 'research', ...toolActivity([res]), stop_reason: res.stop_reason });
    if (res.stop_reason !== 'pause_turn') return { responses, final: res };
    messages.push({ role: 'assistant', content: res.content });
  }
  throw new ClaudeError(`Research paused more than ${maxContinuations} times; stopped to limit cost.`);
}

/** All text Claude wrote across the responses, in order. */
export function extractText(responses) {
  return responses
    .flatMap((r) => r.content || [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * Every URL the tools touched or Claude cited, de-duplicated. Walks nested
 * blocks so results that came back through dynamic filtering are found too.
 */
export function collectSources(responses) {
  const byUrl = new Map();
  const add = (url, title, via) => {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const key = url.replace(/#.*$/, '');
    const prev = byUrl.get(key);
    if (!prev) byUrl.set(key, { url: key, title: title || '', via });
    else if (!prev.title && title) prev.title = title;
  };
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'web_search_result') add(node.url, node.title, 'search');
    if (node.type === 'web_fetch_result') add(node.url, node.content?.title, 'fetch');
    if (node.type === 'web_search_result_location') add(node.url, node.title, 'citation');
    for (const [k, v] of Object.entries(node)) {
      if (k === 'encrypted_content' || k === 'encrypted_index' || k === 'data') continue;
      if (v && typeof v === 'object') walk(v);
    }
  };
  responses.forEach((r) => walk(r.content));
  return [...byUrl.values()];
}

/** Counts searches and fetches, and lists tool errors. */
export function toolActivity(responses) {
  let searches = 0;
  let fetches = 0;
  let usageSearch = 0;
  let usageFetch = 0;
  const errors = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'server_tool_use') {
      if (node.name === 'web_search') searches++;
      if (node.name === 'web_fetch') fetches++;
    }
    if (node.type === 'web_search_tool_result_error' || node.type === 'web_fetch_tool_result_error') {
      errors.push(node.error_code || 'unknown');
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'encrypted_content' || k === 'data') continue;
      if (v && typeof v === 'object') walk(v);
    }
  };
  for (const r of responses) {
    walk(r.content);
    usageSearch += r.usage?.server_tool_use?.web_search_requests || 0;
    usageFetch += r.usage?.server_tool_use?.web_fetch_requests || 0;
  }
  return {
    searches: Math.max(searches, usageSearch),
    fetches: Math.max(fetches, usageFetch),
    errors,
  };
}

/** Sum token usage across responses. */
export function sumUsage(responses) {
  const total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const r of responses) for (const k of Object.keys(total)) total[k] += r.usage?.[k] || 0;
  return total;
}

/** Web tool definitions. 'dynamic' uses the newest versions (dynamic filtering). */
export function webTools({ mode = 'dynamic', maxSearches = 8, maxFetches = 10, location } = {}) {
  const search = { type: mode === 'basic' ? 'web_search_20250305' : 'web_search_20260318', name: 'web_search', max_uses: maxSearches };
  const fetchTool = { type: mode === 'basic' ? 'web_fetch_20250910' : 'web_fetch_20260318', name: 'web_fetch', max_uses: maxFetches, max_content_tokens: 25000 };
  if (location && (location.city || location.region || location.country)) {
    search.user_location = { type: 'approximate' };
    if (location.city) search.user_location.city = location.city;
    if (location.region) search.user_location.region = location.region;
    if (location.country) search.user_location.country = location.country;
  }
  return [search, fetchTool];
}
