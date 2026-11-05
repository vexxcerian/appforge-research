#!/usr/bin/env node
// Builds dist/: the web app plus the files it loads at runtime.
// GitHub Pages publishes dist/, and the Android app bundles it.
//   node scripts/build-site.mjs [--version abc123]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
const FOLDERS = ['web', 'src', 'prompts', 'schema', 'config'];

const argIdx = process.argv.indexOf('--version');
let version = argIdx > -1 ? process.argv[argIdx + 1] : '';
if (!version) {
  try { version = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { version = ''; }
}
version = (version || String(Date.now())).replace(/[^a-zA-Z0-9._-]/g, '');

fs.rmSync(DIST, { recursive: true, force: true });
for (const f of FOLDERS) fs.cpSync(path.join(ROOT, f), path.join(DIST, f), { recursive: true });

// Stamp the offline cache version so each deploy replaces the old copy.
const swPath = path.join(DIST, 'web', 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes("const VERSION = 'dev';")) throw new Error('sw.js version marker not found');
fs.writeFileSync(swPath, sw.replace("const VERSION = 'dev';", `const VERSION = '${version}';`));

fs.writeFileSync(path.join(DIST, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#070d1a">
<title>AppForge Research</title>
<meta http-equiv="refresh" content="0; url=web/index.html">
<style>body{background:#070d1a;margin:0}</style>
<script>// Name the file: Android's app server sends extension-less paths like web/ back to this page.
location.replace('web/index.html' + location.search + location.hash);</script>
</head><body></body></html>
`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`dist/ built (version ${version})`);
