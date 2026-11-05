import {
  researchBusiness, buildReview, applyOwnerAnswers, markOwnershipVerified, verificationOptions,
  planFeatures, buildAppBrief, generateAppHtml, formatHours, parseHoursText, loadProfileSchema, validate,
} from '../src/index.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off: state lives in memory */ } },
};

// ---------------------------------------------------------------- app shell
// Inside the Android app (Capacitor), native HTTP can read other websites,
// which browsers block. That turns on website colors and the Google lookup.
const native = () => !!window.Capacitor?.isNativePlatform?.();
const NativeHttp = () => window.Capacitor?.Plugins?.CapacitorHttp;

async function nativeFetch(url, init = {}) {
  const Http = NativeHttp();
  if (!Http) return fetch(url, init);
  let data;
  if (init.body) { try { data = JSON.parse(init.body); } catch { data = init.body; } }
  const r = await Http.request({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, data, responseType: 'text', connectTimeout: 15000, readTimeout: 20000 });
  const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
  const res = new Response(body, { status: r.status >= 200 && r.status <= 599 ? r.status : 502, headers: r.headers || {} });
  Object.defineProperty(res, 'url', { value: r.url || String(url) });
  return res;
}

if ('serviceWorker' in navigator && !native() && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode just won't be available */ });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  document.getElementById('install').hidden = false;
});
document.getElementById('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  document.getElementById('install').hidden = true;
});
{
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let dismissed = false;
  try { dismissed = localStorage.getItem('afr.iosHint') === 'no'; } catch { /* ignore */ }
  const hint = document.getElementById('ios-install');
  if (ios && !standalone && !native() && !dismissed) {
    hint.hidden = false;
    hint.insertAdjacentHTML('beforeend', ' <button class="ghost" type="button" id="ios-hide">Got it</button>');
    document.getElementById('ios-hide').addEventListener('click', () => {
      hint.hidden = true;
      try { localStorage.setItem('afr.iosHint', 'no'); } catch { /* ignore */ }
    });
  }
}

const DEFAULT_SETTINGS = { anthropicKey: '', placesKey: '', researchModel: 'claude-sonnet-5-5', generateModel: 'claude-opus-5-5', appIdPrefix: 'com.appforge' };
let settings = { ...DEFAULT_SETTINGS, ...store.get('afr.settings', {}) };
let state = store.get('afr.state', null) || { step: 'intake', intake: {}, profile: null, notes: '', warnings: [] };
let busy = false;
const save = () => store.set('afr.state', state);

// ---------------------------------------------------------------- chrome
function setStep(step) {
  state.step = step;
  save();
  const order = ['intake', 'review', 'build'];
  for (const li of document.querySelectorAll('#steps li')) {
    const i = order.indexOf(li.dataset.step);
    if (li.dataset.step === step) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    li.classList.toggle('done', i < order.indexOf(step));
  }
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  const view = $('#view');
  if (state.step === 'review' && state.profile) return renderReview(view);
  if (state.step === 'build' && state.profile) return renderBuild(view);
  return renderIntake(view);
}

$('#open-settings').addEventListener('click', () => {
  const f = $('#settings-form');
  for (const [k, v] of Object.entries(settings)) if (f.elements[k]) f.elements[k].value = v;
  $('#settings').showModal();
});
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  const f = $('#settings-form');
  for (const k of Object.keys(DEFAULT_SETTINGS)) settings[k] = f.elements[k].value.trim() || DEFAULT_SETTINGS[k];
  store.set('afr.settings', settings);
  render();
});
$('#open-file').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const profile = JSON.parse(await file.text());
    const errors = validate(await loadProfileSchema(), profile);
    if (errors.length) throw new Error(`${errors.length} problems, first: ${errors[0].path} ${errors[0].message}`);
    state = { step: 'review', intake: { name: profile.business.name }, profile, notes: '', warnings: [] };
    setStep(profile.owner_confirmed.confirmed ? 'build' : 'review');
  } catch (err) {
    alert(`That file isn't a business profile: ${err.message}`);
  }
});

// ---------------------------------------------------------------- 1. intake
function renderIntake(view) {
  const i = state.intake || {};
  view.innerHTML = `
    <h1>Who are we building for?</h1>
    <p class="lede">Give the business name and town. Research checks their website, Google listing, social pages and reviews, then the owner confirms what it found.</p>
    ${settings.anthropicKey ? '' : '<p class="note warn">Add your Anthropic API key under Keys first.</p>'}
    <form class="stack" id="intake">
      <label>Business name <input type="text" name="name" required maxlength="120" value="${esc(i.name)}" autocomplete="organization"></label>
      <label>City and state <input type="text" name="location" placeholder="Cullman, AL" value="${esc(i.location)}"></label>
      <label>Website <small>Optional, but it makes research faster and more accurate.</small><input type="url" name="website" inputmode="url" placeholder="https://" value="${esc(i.website)}"></label>
      <label>Phone <small>Optional. Helps tell apart businesses with the same name.</small><input type="tel" name="phone" value="${esc(i.phone)}"></label>
      <label>Google Maps link <small>Optional.</small><input type="url" name="google_maps_url" value="${esc(i.google_maps_url)}"></label>
      <label>Anything we should know <small>Optional. For example: "home bakery, cakes by order only".</small><textarea name="notes" maxlength="2000">${esc(i.notes)}</textarea></label>
      <button class="primary" type="submit" ${busy ? 'disabled' : ''}>Research this business</button>
    </form>
    <ul class="log" id="log" hidden></ul>
    <div id="intake-error"></div>`;
  $('#intake').addEventListener('submit', onResearch);
}

async function onResearch(e) {
  e.preventDefault();
  if (busy) return;
  if (!settings.anthropicKey) { $('#open-settings').click(); return; }
  const intake = Object.fromEntries(new FormData(e.target));
  state.intake = intake;
  save();
  busy = true;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Researching…';
  const log = $('#log');
  log.hidden = false;
  const steps = {
    places: settings.placesKey ? 'Checking the Google listing' : null,
    research: 'Searching the web and reading their pages',
    extract: 'Building the business profile',
  };
  log.innerHTML = Object.entries(steps).filter(([, v]) => v).map(([k, v]) => `<li data-k="${k}">${v}</li>`).join('');
  const mark = (k, text) => {
    const items = [...log.children];
    const idx = items.findIndex((li) => li.dataset.k === k);
    items.forEach((li, j) => { li.classList.toggle('ok', j < idx); li.classList.toggle('active', j === idx); });
    if (text && items[idx]) items[idx].textContent = text;
  };
  $('#intake-error').innerHTML = '';
  try {
    const result = await researchBusiness(intake, {
      apiKey: settings.anthropicKey,
      placesApiKey: settings.placesKey || undefined,
      researchModel: settings.researchModel,
      // Browsers can't read other sites' CSS; the Android app and the CLI can.
      brandSignals: native(),
      siteFetchImpl: native() ? nativeFetch : undefined,
      placesFetchImpl: native() ? nativeFetch : undefined,
      onProgress: (ev) => {
        if (ev.step === 'research' && ev.searches !== undefined) mark('research', `Searching the web and reading their pages: ${ev.searches} searches, ${ev.fetches} pages so far`);
        else if (ev.step in steps) mark(ev.step);
      },
    });
    state.profile = result.profile;
    state.notes = result.notes;
    state.warnings = result.warnings;
    busy = false;
    setStep('review');
  } catch (err) {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Research this business';
    log.hidden = true;
    $('#intake-error').innerHTML = `<p class="note error">Research stopped: ${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- 2. review
function sourceStamps(p, field) {
  const prov = (p.facts_provenance || []).find((f) => f.field === field);
  if (!prov) return '';
  return prov.source_ids.map((id) => {
    const s = p.sources.find((x) => x.id === id);
    if (!s) return '';
    if (s.kind === 'owner') return `<span class="stamp owner" title="Confirmed by the owner">Owner</span>`;
    const url = safeUrl(s.url);
    return url ? `<a class="stamp" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${esc(s.id)}</a>` : `<span class="stamp">${esc(s.id)}</span>`;
  }).join('');
}

function fact(p, label, value, field, pending) {
  const has = value && String(value).trim();
  const cls = !has ? 'none' : pending.has(field) ? 'check' : '';
  return `<div class="fact ${cls}"><dt>${label}</dt><dd>${has ? value : '<span class="hint">Not found</span>'}</dd>${field && has ? `<div class="stamps">${sourceStamps(p, field)}</div>` : ''}</div>`;
}

function renderReview(view) {
  const p = state.profile;
  const review = buildReview(p);
  const pending = new Set(review.questions.map((q) => q.field));
  const a = p.contact.address;
  const where = [a.city, a.region].filter(Boolean).join(', ');
  const addr = p.contact.address_is_public ? [a.street, a.city, a.region, a.postal_code].filter(Boolean).join(', ') : (where ? `${where} (home-based, street address kept private)` : '');
  const items = p.offerings.categories.reduce((n, c) => n + c.items.length, 0);
  const idPill = { confirmed: ['ok', 'Right business'], likely: ['check', 'Probably the right business'], uncertain: ['bad', 'Not sure this is the right business'] }[p.confidence.identity_match];

  view.innerHTML = `
    <div class="who">
      <h1>${esc(p.business.name)}</h1>
      <p>${esc(p.business.subcategory || p.business.industry.replace(/_/g, ' '))}${where ? `, ${esc(where)}` : ''}</p>
    </div>
    <p class="row" style="gap:8px"><span class="pill ${idPill[0]}">${idPill[1]}</span>${p.business.status !== 'operating' ? `<span class="pill bad">Status: ${esc(p.business.status.replace(/_/g, ' '))}</span>` : ''}</p>
    ${state.warnings?.length ? `<div class="note warn">While researching:<ul>${state.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

    <h2>What research found</h2>
    <dl class="facts">
      ${fact(p, 'Name', esc(p.business.name), 'business.name', pending)}
      ${fact(p, 'About', esc(p.business.description), null, pending)}
      ${fact(p, 'Phone', esc(p.contact.phone), 'contact.phone', pending)}
      ${fact(p, 'Address', esc(addr), 'contact.address', pending)}
      ${fact(p, 'Website', safeUrl(p.contact.website) ? `<a href="${esc(p.contact.website)}" target="_blank" rel="noopener noreferrer">${esc(p.contact.website.replace(/^https?:\/\//, ''))}</a>` : '', 'contact.website', pending)}
      ${fact(p, 'Hours', p.hours.known ? esc(formatHours(p.hours.weekly)) + (p.hours.notes ? `<br><span class="hint">${esc(p.hours.notes)}</span>` : '') : '', 'hours', pending)}
      ${fact(p, 'Sells', items ? `${items} items in ${p.offerings.categories.length} groups: ${esc(p.offerings.categories.map((c) => c.name).join(', '))}` : '', 'offerings', pending)}
      ${fact(p, 'Uses', esc(p.existing_tools.map((t) => t.provider || t.type.replace(/_/g, ' ')).join(', ')), 'existing_tools', pending)}
      ${fact(p, 'Colors', p.brand.colors.length ? `<span class="swatches">${p.brand.colors.map((c) => `<span class="swatch" style="background:${esc(c.hex)}" title="${esc(c.role)} ${esc(c.hex)}"></span>`).join('')}</span>` : '', 'brand.colors', pending)}
      ${fact(p, 'Reviews', p.reputation.has_reviews ? `${p.reputation.rating} stars from ${p.reputation.review_count} reviews on ${esc(p.reputation.rating_source)}` : '', 'reputation', pending)}
    </dl>

    <h2>Questions for the owner</h2>
    ${review.questions.length ? '' : '<p class="note">Nothing to check. Confirm below.</p>'}
    <form class="stack" id="review">
      ${review.questions.map(questionHtml).join('')}
      <h2>How was ownership checked?</h2>
      <label>Ownership <small>Required before the app goes to the app stores.</small>
        <select name="ownership">
          <option value="">Not checked yet</option>
          ${review.ownership.map((o) => `<option value="${esc(o.method)}" ${p.owner_confirmed.verification_method === o.method ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </label>
      <button class="primary" type="submit">Confirm profile</button>
      <button class="ghost" type="button" id="restart">Research a different business</button>
    </form>
    <div id="review-msg"></div>

    <h2>Sources</h2>
    <ul>${p.sources.filter((s) => s.kind !== 'owner').map((s) => `<li>${esc(s.id)}: ${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : esc(s.title)}</li>`).join('')}</ul>
    ${state.notes ? `<details><summary>Research notes</summary><pre class="notes">${esc(state.notes)}</pre></details>` : ''}`;

  for (const ta of view.querySelectorAll('textarea[data-hours]')) {
    const out = ta.parentElement.querySelector('.preview-line');
    const update = () => {
      const parsed = parseHoursText(ta.value);
      out.textContent = parsed.length ? `Reads as: ${formatHours(parsed)}` : 'Could not read these hours yet. Try "Mon-Fri 7am-2pm, Sat 8am-noon".';
      out.classList.toggle('warn', !parsed.length);
    };
    ta.addEventListener('input', update);
    update();
  }
  for (const box of view.querySelectorAll('input[data-skip]')) {
    box.addEventListener('change', () => box.closest('.q').classList.toggle('skipped', box.checked));
  }
  $('#review').addEventListener('submit', onConfirm);
  $('#restart').addEventListener('click', () => { state.profile = null; setStep('intake'); });
}

function questionHtml(q) {
  const name = `a_${q.id}`;
  const found = q.current_value ? `<p class="found">Found: <b>${esc(q.current_value)}</b></p>` : '';
  let input;
  if (q.input === 'yes_no') {
    input = `<div class="choice"><label><input type="radio" name="${name}" value="yes" checked> Yes</label><label><input type="radio" name="${name}" value="no"> No</label></div>`;
  } else if (q.input === 'hours') {
    input = `<label class="hint">Hours<textarea name="${name}" data-hours rows="2">${esc(q.current_value)}</textarea><span class="preview-line"></span></label>`;
  } else if (q.input === 'colors') {
    const hexes = (q.current_value.match(/#[0-9a-f]{6}/gi) || ['#2563eb', '#f59e0b']).slice(0, 4);
    input = `<div class="row" style="flex:0">${hexes.map((h, i) => `<input type="color" name="${name}" value="${esc(h)}" aria-label="Color ${i + 1}">`).join('')}</div>`;
  } else if (q.input === 'long_text') {
    input = `<textarea name="${name}" placeholder="One item per line, for example: Cinnamon roll - $4.50">${esc(q.current_value)}</textarea>`;
  } else {
    input = `<input type="text" name="${name}" value="${esc(q.current_value)}">`;
  }
  return `<fieldset class="q" data-field="${esc(q.field)}" data-id="${q.id}" data-input="${q.input}" data-current="${esc(q.current_value)}">
    <p>${esc(q.question)}</p>${q.input === 'hours' || q.input === 'colors' ? '' : found}${input}
    <label class="skip"><input type="checkbox" data-skip> Skip for now</label>
  </fieldset>`;
}

async function onConfirm(e) {
  e.preventDefault();
  const form = e.target;
  const answers = [];
  for (const fs of form.querySelectorAll('fieldset.q')) {
    if (fs.querySelector('[data-skip]').checked) continue;
    const field = fs.dataset.field;
    const name = `a_${fs.dataset.id}`;
    const current = fs.dataset.current;
    if (fs.dataset.input === 'yes_no') {
      const yes = form.querySelector(`input[name="${name}"]:checked`)?.value !== 'no';
      answers.push({ field, value: yes, accepted: yes });
    } else if (fs.dataset.input === 'colors') {
      answers.push({ field, value: [...form.querySelectorAll(`input[name="${name}"]`)].map((i) => i.value) });
    } else {
      const v = form.elements[name].value.trim();
      if (v && v === current) answers.push({ field, accepted: true });
      else if (v) answers.push({ field, value: v });
    }
  }
  const { profile, identityRejected, remaining } = applyOwnerAnswers(state.profile, answers);
  if (identityRejected) {
    state.profile = null;
    setStep('intake');
    $('#intake-error').innerHTML = '<p class="note warn">Research found the wrong business. Add the website, phone or Google Maps link and run it again.</p>';
    return;
  }
  let p = profile;
  const method = form.elements.ownership.value;
  if (method) p = markOwnershipVerified(p, method);
  state.profile = p;
  save();
  if (remaining.length) {
    render();
    $('#review-msg').innerHTML = `<p class="note warn">Saved. ${remaining.length} question${remaining.length > 1 ? 's are' : ' is'} still open; answer ${remaining.length > 1 ? 'them' : 'it'} to continue.</p>`;
    $('#review-msg').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  setStep('build');
}

// ---------------------------------------------------------------- 3. build
async function renderBuild(view) {
  const p = state.profile;
  const plan = await planFeatures(p);
  if (plan.blocked) {
    view.innerHTML = `<h1>Not ready to build</h1><div class="note error"><ul>${plan.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div><p><button class="ghost" id="back">Back to owner review</button></p>`;
    $('#back').addEventListener('click', () => setStep('review'));
    return;
  }
  const brief = await buildAppBrief(p, plan, { appIdPrefix: settings.appIdPrefix });
  const names = Object.fromEntries(plan.modules.map((m) => [m.id, m.name]));
  const pal = brief.prompt.match(/primary (#[0-9a-f]{6}).*?text on primary (#[0-9a-f]{6})/i) || [];

  view.innerHTML = `
    <div class="who"><h1>${esc(p.business.name)}</h1><p>${plan.modules.length} screens, planned from what the business offers and what its customers ask for.</p></div>
    ${plan.warnings.length ? `<div class="note warn"><ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

    <h2>Tab bar</h2>
    <div class="phone"><div class="tabbar" style="background:${esc(pal[1] || '#2563eb')};color:${esc(pal[2] || '#fff')}">${plan.navigation.tabs.map((t) => `<span>${esc(t === 'more' ? 'More' : names[t] || t)}</span>`).join('')}</div></div>

    <h2>Screens</h2>
    <ul class="modules">${plan.modules.map((m) => `
      <li><strong>${esc(m.name)}</strong><span class="mode ${m.mode === 'deep_link' ? 'link' : ''}">${m.mode === 'deep_link' ? `Links to ${esc(m.tool.provider || 'their tool')}` : 'Built in'}</span>
      <span class="why">${esc(cap(m.reason))}</span>${m.data_ready ? '' : `<span class="need">Needs: ${esc(m.missing.join(', '))}</span>`}</li>`).join('')}
    </ul>

    ${plan.suggested.length ? `<h2>Could add later</h2><ul class="modules">${plan.suggested.map((m) => `<li><strong>${esc(m.name)}</strong><span class="why">${esc(cap(m.reason))}</span></li>`).join('')}</ul>` : ''}

    <h2>Hand off to AppForge</h2>
    <p class="hint">Paste the brief into the AppForge builder, or generate the app here and download it.</p>
    <div class="row">
      <button class="ghost" id="copy-brief">Copy brief</button>
      <button class="ghost" id="dl-brief">Download brief.md</button>
      <button class="ghost" id="dl-app">Download app.json</button>
      <button class="ghost" id="dl-profile">Download profile</button>
    </div>
    <p style="margin-top:16px"><button class="primary" id="generate" style="width:100%">Generate the app</button></p>
    <div id="gen"></div>
    <p><button class="ghost" id="back">Back to owner review</button></p>`;

  $('#copy-brief').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(brief.prompt); e.target.textContent = 'Brief copied'; }
    catch { download('brief.md', brief.prompt, 'text/markdown'); }
  });
  $('#dl-brief').addEventListener('click', () => download('brief.md', brief.prompt, 'text/markdown'));
  $('#dl-app').addEventListener('click', () => download('app.json', JSON.stringify(brief.manifest, null, 2) + '\n', 'application/json'));
  $('#dl-profile').addEventListener('click', () => download(`${brief.slug}.profile.json`, JSON.stringify(p, null, 2) + '\n', 'application/json'));
  $('#back').addEventListener('click', () => setStep('review'));
  $('#generate').addEventListener('click', async (e) => {
    if (!settings.anthropicKey) { $('#open-settings').click(); return; }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Writing the app… this takes a few minutes';
    $('#gen').innerHTML = '';
    try {
      const out = await generateAppHtml(brief, { apiKey: settings.anthropicKey, model: settings.generateModel });
      $('#gen').innerHTML = `${out.truncated ? '<p class="note warn">The app was cut off at the length limit. Generate again, or trim the brief.</p>' : ''}
        <iframe class="app" title="App preview" sandbox="allow-scripts allow-popups"></iframe>
        <div class="row"><button class="ghost" id="dl-html">Download index.html</button></div>`;
      $('#gen iframe').srcdoc = out.html;
      $('#dl-html').addEventListener('click', () => download('index.html', out.html + '\n', 'text/html'));
      btn.textContent = 'Generate again';
    } catch (err) {
      $('#gen').innerHTML = `<p class="note error">Generation stopped: ${esc(err.message)}</p>`;
      btn.textContent = 'Generate the app';
    } finally {
      btn.disabled = false;
    }
  });
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

async function download(name, text, type) {
  const P = window.Capacitor?.Plugins;
  if (native() && P?.Filesystem && P?.Share) {
    try {
      const { uri } = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await P.Share.share({ title: name, url: uri, dialogTitle: `Save or send ${name}` });
      return;
    } catch (e) {
      if (/cancel/i.test(e?.message || '')) return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

setStep(state.profile ? state.step : 'intake');
