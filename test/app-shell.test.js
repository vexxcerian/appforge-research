import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const list = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => fs.statSync(path.join(ROOT, dir, f)).isFile()).map((f) => `${dir}/${f}`);

test('offline cache lists every file the app loads', () => {
  const sw = read('web/sw.js');
  const files = JSON.parse(sw.match(/const APP_FILES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  const needed = [
    ...['src', 'prompts', 'schema', 'config'].flatMap(list).map((f) => `../${f}`),
    ...list('web').filter((f) => f !== 'web/sw.js').map((f) => `./${f.slice(4)}`),
    ...list('web/icons').map((f) => `./${f.slice(4)}`),
  ];
  for (const f of needed) assert.ok(files.includes(f), `sw.js APP_FILES is missing ${f}`);
  for (const f of files.filter((x) => x !== './')) {
    const rel = f.startsWith('../') ? f.slice(3) : `web/${f.slice(2)}`;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `sw.js lists ${f}, which does not exist`);
  }
  assert.match(sw, /const VERSION = 'dev';/, 'build-site needs the version marker');
});

test('web manifest is installable', () => {
  const m = JSON.parse(read('web/manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) assert.ok(m[k], k);
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, 'web', i.src)), i.src);
  const html = read('web/index.html');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
});

test('site build stamps the cache version and redirects to the app', () => {
  execFileSync(process.execPath, ['scripts/build-site.mjs', '--version', 'abc123'], { cwd: ROOT, stdio: 'pipe' });
  assert.match(read('dist/web/sw.js'), /const VERSION = 'abc123';/);
  const root = read('dist/index.html');
  // Android's app server sends any path whose last part has no "." back to
  // index.html, so a redirect to "web/" loops forever. It must name the file.
  const targets = [...root.matchAll(/location\.replace\('([^']+)'/g), ...root.matchAll(/url=([^"]+)"/g)].map((m) => m[1]);
  assert.equal(targets.length, 2);
  for (const t of targets) assert.match(t.split('/').pop(), /\./, `redirect target "${t}" needs a file extension`);
  for (const f of ['src/research.js', 'prompts/research-agent.md', 'schema/business-profile.schema.json', 'config/modules.json', 'web/app.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', f)), f);
  }
  assert.match(read('web/sw.js'), /const VERSION = 'dev';/, 'source file untouched');
});

test('Android config and signing patch', () => {
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.webDir, 'dist');
  assert.match(cap.appId, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  assert.ok(fs.existsSync(path.join(ROOT, 'android-keys', 'debug.keystore')));
  for (const f of ['icon-only.png', 'icon-foreground.png', 'icon-background.png', 'splash.png', 'splash-dark.png']) assert.ok(fs.existsSync(path.join(ROOT, 'assets', f)), f);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afr-android-'));
  fs.mkdirSync(path.join(tmp, 'app'));
  const gradle = `apply plugin: 'com.android.application'
android {
    namespace = "com.vexx.appforgeresearch"
    defaultConfig {
        applicationId "com.vexx.appforgeresearch"
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`;
  fs.writeFileSync(path.join(tmp, 'app', 'build.gradle'), gradle);
  const env = { ...process.env, ANDROID_PROJECT_DIR: tmp, APP_VERSION_CODE: '42', APP_VERSION_NAME: '1.0.42' };
  execFileSync(process.execPath, ['scripts/configure-android.mjs'], { cwd: ROOT, env, stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/configure-android.mjs'], { cwd: ROOT, env, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(tmp, 'app', 'build.gradle'), 'utf8');
  assert.match(out, /versionCode 42/);
  assert.match(out, /versionName "1\.0\.42"/);
  assert.equal(out.split('// appforge-signing').length, 2, 'signing block added once');
  assert.ok(out.indexOf('signingConfigs') < out.indexOf('buildTypes'));
  assert.match(out, /System\.getenv\("ANDROID_KEYSTORE_PATH"\) \?: ".*android-keys\/debug\.keystore"/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
