#!/usr/bin/env node
// Research a business and write its profile for owner review.
//
//   ANTHROPIC_API_KEY=... node bin/research.js --name "Sweet Juniper Bakehouse" --location "Riverbend, AL"
//
// Options: --website URL --phone NUM --maps URL --notes TEXT --out DIR (default profiles)
//          --basic-tools --no-brand --model ID --extract-model ID --max-searches N --max-fetches N
// Env:     ANTHROPIC_API_KEY (required), GOOGLE_PLACES_API_KEY (optional), ANTHROPIC_BASE_URL
import path from 'node:path';
import { researchBusiness, buildReview, slugify } from '../src/index.js';
import { parseArgs, writeFile, fail, apiOptions } from './_cli.js';

const args = parseArgs();
if (args.help || !args.name) {
  console.log('Usage: node bin/research.js --name "Business name" --location "City, ST" [--website URL] [--phone NUM] [--notes TEXT] [--out profiles]');
  process.exit(args.help ? 0 : 1);
}
const api = apiOptions(args);
if (!api.apiKey) fail('Set ANTHROPIC_API_KEY first.');

const started = Date.now();
const intake = { name: args.name, location: args.location, website: args.website, phone: args.phone, google_maps_url: args.maps, notes: args.notes, country: args.country };
console.log(`\nResearching ${args.name}${args.location ? ` (${args.location})` : ''}…`);

let result;
try {
  result = await researchBusiness(intake, {
    ...api,
    placesApiKey: process.env.GOOGLE_PLACES_API_KEY,
    toolMode: args['basic-tools'] ? 'basic' : 'dynamic',
    brandSignals: !args['no-brand'],
    researchModel: args.model || undefined,
    extractModel: args['extract-model'] || undefined,
    maxSearches: args['max-searches'] ? Number(args['max-searches']) : undefined,
    maxFetches: args['max-fetches'] ? Number(args['max-fetches']) : undefined,
    onProgress: (e) => {
      if (e.step === 'research' && e.searches !== undefined) console.log(`  · web: ${e.searches} searches, ${e.fetches} fetches${e.stop_reason === 'pause_turn' ? ' (continuing)' : ''}`);
      else if (e.message) console.log(`  · ${e.message}`);
    },
  });
} catch (e) {
  fail(e.message);
}

const dir = path.join(args.out || 'profiles', slugify(result.profile.business.name || args.name));
const review = buildReview(result.profile);
writeFile(path.join(dir, 'profile.json'), result.profile);
writeFile(path.join(dir, 'research-notes.md'), result.notes + '\n');
writeFile(path.join(dir, 'review.json'), review);
writeFile(path.join(dir, 'run.json'), {
  intake,
  finished_at: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 1000),
  warnings: result.warnings,
  validation: result.validation,
  usage: result.usage,
  sources_seen: result.sources_seen,
  google_listing: result.google_listing,
  brand_signals: result.brand_signals,
});

const p = result.profile;
console.log(`\n✔ ${p.business.name} — ${p.business.subcategory || p.business.industry}`);
console.log(`  identity: ${p.confidence.identity_match}, overall confidence: ${p.confidence.overall}`);
console.log(`  ${p.sources.length} sources, ${result.usage.web_searches} searches, ${result.usage.web_fetches} fetches`);
if (result.warnings.length) console.log(`  warnings:\n${result.warnings.map((w) => `    - ${w}`).join('\n')}`);
if (!result.validation.valid) console.log(`  ⚠ ${result.validation.errors.length} schema problems (see run.json)`);
console.log(`\n${review.questions.length} questions for the owner:`);
for (const q of review.questions) console.log(`  - ${q.question}${q.current_value ? `  [found: ${q.current_value}]` : ''}`);
console.log(`\nSaved to ${dir}/\nNext: node bin/confirm.js ${dir}\n`);
