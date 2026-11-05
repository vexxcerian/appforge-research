import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessage, runServerToolTurn, extractText, collectSources, toolActivity, webTools, sumUsage, ClaudeError } from '../src/claude.js';
import { scriptedFetch, json, researchResponses, message } from './helpers.js';

test('createMessage sends the right headers and no browser header in Node', async () => {
  const f = scriptedFetch([json(message('hi'))]);
  const res = await createMessage({ model: 'm', max_tokens: 5, messages: [] }, { apiKey: 'k', fetchImpl: f, baseUrl: 'https://api.example/' });
  assert.equal(res.content[0].text, 'hi');
  assert.equal(f.calls[0].url, 'https://api.example/v1/messages');
  assert.equal(f.calls[0].headers['x-api-key'], 'k');
  assert.equal(f.calls[0].headers['anthropic-version'], '2026-10-21');
  assert.ok(!('anthropic-dangerous-direct-browser-access' in f.calls[0].headers));
});

test('createMessage turns API errors into ClaudeError with status', async () => {
  const f = scriptedFetch([json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad schema' } }, 400)]);
  await assert.rejects(createMessage({}, { apiKey: 'k', fetchImpl: f }), (e) => e instanceof ClaudeError && e.status === 400 && /bad schema/.test(e.message));
  await assert.rejects(createMessage({}, { apiKey: '' }), /Missing Anthropic API key/);
});

test('pause_turn continues with each paused response as its own assistant message, in order', async () => {
  const [paused, done] = researchResponses();
  const paused2 = { ...paused, id: 'msg_1b' };
  const f = scriptedFetch([json(paused), json(paused2), json(done)]);
  const body = { model: 'm', max_tokens: 10, tools: webTools(), messages: [{ role: 'user', content: 'go' }] };
  const { responses, final } = await runServerToolTurn(body, { apiKey: 'k', fetchImpl: f });
  assert.equal(responses.length, 3);
  assert.equal(final.stop_reason, 'end_turn');
  const third = f.calls[2].body.messages;
  assert.deepEqual(third.map((m) => m.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(third[1].content, paused.content);
  assert.deepEqual(third[2].content, paused2.content);
  assert.deepEqual(f.calls[2].body.tools, body.tools, 'same tools on every continuation');
  assert.equal(body.messages.length, 1, 'caller body not mutated');
});

test('runServerToolTurn stops after too many pauses', async () => {
  const [paused] = researchResponses();
  const f = scriptedFetch(Array(3).fill(0).map(() => json(paused)));
  await assert.rejects(runServerToolTurn({ messages: [] }, { apiKey: 'k', fetchImpl: f }, { maxContinuations: 2 }), /paused more than 2 times/);
});

test('sources, text and tool activity are read from nested blocks', () => {
  const responses = researchResponses();
  const urls = collectSources(responses).map((s) => s.url).sort();
  assert.deepEqual(urls, [
    'https://sweetjuniperbakehouse.example',
    'https://www.facebook.com/sweetjuniperbakehouse',
    'https://www.yelp.com/biz/sweet-juniper-bakehouse-riverbend',
  ]);
  const act = toolActivity(responses);
  assert.equal(act.searches, 2);
  assert.equal(act.fetches, 1);
  assert.deepEqual(act.errors, ['too_many_requests']);
  assert.match(extractText(responses), /^Let me look this up\. I'll start/);
  assert.equal(sumUsage(responses).input_tokens, 6000);
});

test('webTools picks versions by mode and adds location', () => {
  const [s, f] = webTools({ mode: 'dynamic', location: { city: 'Cullman', region: 'AL', country: 'US' } });
  assert.equal(s.type, 'web_search_20260318');
  assert.equal(f.type, 'web_fetch_20260318');
  assert.deepEqual(s.user_location, { type: 'approximate', city: 'Cullman', region: 'AL', country: 'US' });
  const [s2, f2] = webTools({ mode: 'basic' });
  assert.equal(s2.type, 'web_search_20250305');
  assert.equal(f2.type, 'web_fetch_20250910');
  assert.ok(!('user_location' in s2));
});
