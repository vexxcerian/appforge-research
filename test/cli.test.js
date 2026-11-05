import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockApi, SCHEMA } from './helpers.js';
import { validate } from '../src/schema-tools.js';

const run = promisify(execFile);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const node = (script, args, env) => run(process.execPath, [path.join(ROOT, 'bin', script), ...args], { cwd: ROOT, env: { ...process.env, ...env } });

test('CLI end to end: research -> confirm -> plan -> generate into an AppForge checkout', async () => {
  const api = await startMockApi();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afr-'));
  const env = { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: api.url, GOOGLE_PLACES_API_KEY: '' };
  try {
    const out = path.join(tmp, 'profiles');
    const r = await node('research.js', ['--name', 'Sweet Juniper Bakehouse', '--location', 'Riverbend, AL', '--out', out, '--no-brand'], env);
    assert.match(r.stdout, /questions for the owner/);
    const dir = path.join(out, 'sweet-juniper-bakehouse');
    for (const f of ['profile.json', 'research-notes.md', 'review.json', 'run.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
    const profile = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
    assert.deepEqual(validate(SCHEMA, profile), []);
    assert.ok(api.requests.every((q) => q.headers['x-api-key'] === 'test-key'));

    // plan refuses before the owner confirms
    await assert.rejects(node('plan.js', [dir], env), (e) => /can't be built yet/.test(e.stderr));

    const review = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
    const answers = review.questions.map((q) => (q.field === 'hours' ? { field: 'hours', value: 'Tue-Fri 7am-2pm, Sat 8am-1pm' } : { field: q.field, accepted: true }));
    fs.writeFileSync(path.join(tmp, 'answers.json'), JSON.stringify(answers));
    const c = await node('confirm.js', [dir, '--answers', path.join(tmp, 'answers.json'), '--verified', 'code_to_listed_phone'], env);
    assert.match(c.stdout, /Owner confirmed the profile/);
    assert.ok(fs.existsSync(path.join(dir, 'profile.before-review.json')));

    const p = await node('plan.js', [dir, '--app-id-prefix', 'com.vexx'], env);
    assert.match(p.stdout, /modules/);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    assert.equal(manifest.appId, 'com.vexx.sweetjuniperbakehouse');
    assert.ok(fs.readFileSync(path.join(dir, 'brief.md'), 'utf8').startsWith('Build a mobile app for **Sweet Juniper Bakehouse**'));

    const appforge = path.join(tmp, 'appforge');
    const g = await node('generate.js', [dir, '--appforge', appforge], env);
    assert.match(g.stdout, /Copied to/);
    const html = fs.readFileSync(path.join(appforge, 'apps', 'sweet-juniper-bakehouse', 'index.html'), 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.ok(fs.existsSync(path.join(appforge, 'apps', 'sweet-juniper-bakehouse', 'app.json')));
    const genReq = api.requests.at(-1).body;
    assert.equal(genReq.model, 'claude-opus-5-5');
    assert.match(genReq.messages[0].content, /BUSINESS_DATA/);
  } finally {
    await api.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI explains missing setup', async () => {
  await assert.rejects(node('research.js', ['--name', 'X'], { ANTHROPIC_API_KEY: '' }), (e) => /ANTHROPIC_API_KEY/.test(e.stderr));
  await assert.rejects(node('research.js', [], {}), (e) => /Usage/.test(e.stdout));
});
