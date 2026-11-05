import fs from 'node:fs';
import http from 'node:http';

export const SAMPLE = JSON.parse(fs.readFileSync(new URL('../examples/sample-profile.json', import.meta.url), 'utf8'));
export const SCHEMA = JSON.parse(fs.readFileSync(new URL('../schema/business-profile.schema.json', import.meta.url), 'utf8'));
export const clone = (x) => structuredClone(x);

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers each call with the next handler and records requests. */
export function scriptedFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), headers: init.headers || {}, body });
    const h = handlers[calls.length - 1];
    if (!h) throw new Error(`Unexpected fetch #${calls.length} to ${url}`);
    return typeof h === 'function' ? h({ url: String(url), body, headers: init.headers }) : h;
  };
  fn.calls = calls;
  return fn;
}

export const SAMPLE_NOTES = `I'll start by searching.
# Research notes: Sweet Juniper Bakehouse
## Identity
- Matches Google listing [S1] and website [S2] on name, address and phone.
## Status
- Operating; posted on Facebook this week [S3].
## Business type and how customers buy
- Bakery with a storefront; custom cakes ordered ahead [S2].
## Contact and location
- 214 Main St, Riverbend, AL 35000; (256) 555-0142 [S1][S2]
## Hours
- Tue-Fri 7-2, Sat 8-1 [S1]
## Offerings
- Country Sourdough $9; Cinnamon Roll $4.50 [S2]
## Tools they already use
- Square Online ordering https://sweetjuniperbakehouse.square.site [S2]
## Brand and voice
- Green and gold (observed) [S2]
## Online presence
- Facebook, Instagram [S3]
## Customers and reputation
- 4.8 stars from 212 Google reviews [S1]; Saturday sellouts, hard to reach by phone [S4]
## Competitors and differentiators
- Downtown Donut Co. has pre-ordering.
## App opportunities
- online_ordering, quote_request, specials
## Open questions for the owner
- Are Saturday hours still 8-1?
## Sources
S1: https://maps.google.com/?cid=1234567890 | Google listing | google_listing
S2: https://sweetjuniperbakehouse.example | Home | business_website
S3: https://www.facebook.com/sweetjuniperbakehouse | Facebook | social_profile
S4: https://www.yelp.com/biz/sweet-juniper-bakehouse-riverbend | Yelp | review_site
`;

/** Research turn that pauses once, with results nested the way dynamic filtering returns them. */
export function researchResponses(notes = SAMPLE_NOTES) {
  const paused = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    stop_reason: 'pause_turn',
    content: [
      { type: 'text', text: 'Let me look this up. ' },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'code_execution', input: { code: 'search()' } },
      {
        type: 'code_execution_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: {
          nested: [
            { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_search', input: { query: 'Sweet Juniper Bakehouse Riverbend' }, caller: 'srvtoolu_1' },
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srvtoolu_2',
              caller: 'srvtoolu_1',
              content: [
                { type: 'web_search_result', url: 'https://www.facebook.com/sweetjuniperbakehouse', title: 'Sweet Juniper Bakehouse | Facebook', encrypted_content: 'xxx' },
                { type: 'web_search_result', url: 'https://www.yelp.com/biz/sweet-juniper-bakehouse-riverbend', title: 'Yelp', encrypted_content: 'yyy' },
              ],
            },
          ],
        },
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
  };
  const done = {
    id: 'msg_2',
    type: 'message',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', id: 'srvtoolu_3', name: 'web_fetch', input: { url: 'https://sweetjuniperbakehouse.example' } },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 'srvtoolu_3',
        content: { type: 'web_fetch_result', url: 'https://sweetjuniperbakehouse.example', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Welcome' }, title: 'Home' }, retrieved_at: '2026-11-05T18:00:00Z' },
      },
      { type: 'server_tool_use', id: 'srvtoolu_4', name: 'web_search', input: { query: 'x' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_4', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
      { type: 'text', text: notes, citations: [{ type: 'web_search_result_location', url: 'https://www.yelp.com/biz/sweet-juniper-bakehouse-riverbend', title: 'Yelp', cited_text: '...' }] },
    ],
    usage: { input_tokens: 5000, output_tokens: 900, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
  };
  return [paused, done];
}

/** What the extraction step would return: the sample minus code fields, with a few faults to repair. */
export function extractionPayload({ faults = true } = {}) {
  const p = clone(SAMPLE);
  for (const k of ['schema_version', 'generated_at', 'research_meta', 'owner_confirmed']) delete p[k];
  if (faults) {
    p.business.industry = 'Cafe_Bakery';
    p.business.tagline = 'Small-batch breads and pastries baked fresh every single morning by our family in the heart of downtown Riverbend for everyone';
    p.sources.push({ id: 'S5', url: 'https://made-up.example/never-seen', title: 'Invented', kind: 'news' });
    p.facts_provenance.push({ field: 'business.year_founded', source_ids: ['S5'], basis: 'news' });
    p.brand.colors = [];
    p.needs_confirmation = [];
  }
  return p;
}

export const message = (text, stop_reason = 'end_turn') => ({
  id: 'msg_x', type: 'message', role: 'assistant', stop_reason, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 },
});

export const SITE_HTML = `<!doctype html><html><head>
<title>Sweet Juniper Bakehouse | Home</title>
<meta name="theme-color" content="#3F6B4F">
<meta property="og:site_name" content="Sweet Juniper Bakehouse">
<meta name="description" content="Small-batch bread">
<link rel="stylesheet" href="/css/site.css">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Work+Sans&display=swap" rel="stylesheet">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>.btn{background:#e8a33d;color:#fff} .x{color:rgba(0,0,0,0)}</style>
</head><body>
<img class="site-logo" src="/images/logo.png" alt="Sweet Juniper logo">
<a href="https://www.facebook.com/sweetjuniperbakehouse">Facebook</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="https://instagram.com/sweetjuniperbakes">Instagram</a>
<div style="border-color:#3f6b4f"></div>
<script src="https://static.wixstatic.com/x.js"></script>
</body></html>`;

export const SITE_CSS = `body{background:#fbf6ee;color:#2b2b2b;font-family:"Fraunces", serif}
h1,h2{color:#3f6b4f} a{color:#3f6c50} .accent{color:#E8A33D} footer{background:#3f6b4f} .muted{color:#888}`;

/** Serves the sample site on localhost. */
export async function startSite() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SITE_HTML); return; }
    if (req.url === '/css/site.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(SITE_CSS); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

/** A fake Anthropic API: answers research, extraction and generation requests. */
export async function startMockApi({ extraction = extractionPayload({ faults: false }), html = '<!doctype html><html><head><title>Sweet Juniper</title></head><body>App</body></html>' } = {}) {
  const requests = [];
  const research = researchResponses();
  let researchCall = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ url: req.url, headers: req.headers, body });
    let reply;
    if (body.tools?.some((t) => t.name === 'web_search')) reply = research[Math.min(researchCall++, 1)];
    else if (body.output_config) reply = message(JSON.stringify(extraction));
    else reply = message('Here you go:\n```html\n' + html + '\n```');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}
