// Optional last step: turn a build brief into apps/<slug>/index.html with
// Claude, the same way the AppForge builder does from a prompt.

import { createMessage, extractText, CLAUDE_DEFAULTS, ClaudeError } from './claude.js';
import { loadPrompt } from './assets.js';

export const GENERATE_DEFAULT_MODEL = 'claude-opus-5-5';

export async function generateAppHtml(brief, { apiKey, baseUrl, apiVersion, fetchImpl, model = GENERATE_DEFAULT_MODEL, maxTokens = 32000 } = {}) {
  const system = await loadPrompt('app-generator');
  const res = await createMessage({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: brief.prompt }],
  }, { apiKey, baseUrl, apiVersion: apiVersion || CLAUDE_DEFAULTS.apiVersion, fetchImpl });
  if (res.stop_reason === 'refusal') throw new ClaudeError('App generation was refused by the model.');
  const html = extractHtml(extractText([res]));
  if (!html) throw new ClaudeError(res.stop_reason === 'max_tokens' ? 'The app was cut off at the length limit.' : 'No HTML came back.');
  return { html, truncated: res.stop_reason === 'max_tokens', usage: res.usage };
}

export function extractHtml(text) {
  const fenced = text.match(/```html\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return '';
  const end = body.toLowerCase().lastIndexOf('</html>');
  return end === -1 ? body.slice(start).trim() : body.slice(start, end + 7).trim();
}
