#!/usr/bin/env node
// Generate the app's index.html from brief.md with Claude, and optionally drop
// it into an AppForge checkout so the pipeline builds web, Android and iOS.
//
//   ANTHROPIC_API_KEY=... node bin/generate.js profiles/sweet-juniper-bakehouse [--appforge ../appforge] [--model claude-opus-5-5]
import fs from 'node:fs';
import path from 'node:path';
import { generateAppHtml } from '../src/index.js';
import { parseArgs, readJson, writeFile, fail, apiOptions } from './_cli.js';

const args = parseArgs();
const dir = args._[0];
if (!dir || !fs.existsSync(path.join(dir, 'brief.md'))) fail('Pass the profile folder after running bin/plan.js (it needs brief.md and app.json).');
const api = apiOptions(args);
if (!api.apiKey) fail('Set ANTHROPIC_API_KEY first.');

const brief = fs.readFileSync(path.join(dir, 'brief.md'), 'utf8');
if (brief.startsWith('> DRAFT') && !args.draft) fail('This brief is a draft (owner has not confirmed). Pass --draft to generate a preview anyway.');
const manifest = readJson(path.join(dir, 'app.json'));

console.log(`\nGenerating ${manifest.name} (this can take a few minutes)…`);
let out;
try { out = await generateAppHtml({ prompt: brief }, { ...api, model: args.model || undefined }); }
catch (e) { fail(e.message); }
writeFile(path.join(dir, 'index.html'), out.html + '\n');
console.log(`✔ ${path.join(dir, 'index.html')} (${Math.round(out.html.length / 1024)} KB)${out.truncated ? '  ⚠ cut off at the length limit; regenerate or shorten the brief' : ''}`);

if (args.appforge) {
  const target = path.join(args.appforge, 'apps', manifest.slug);
  writeFile(path.join(target, 'index.html'), out.html + '\n');
  writeFile(path.join(target, 'app.json'), manifest);
  console.log(`✔ Copied to ${target}/ — commit and push AppForge to build web, Android and iOS.`);
}
console.log('');
