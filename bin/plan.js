#!/usr/bin/env node
// Plan the app's modules and write the build brief and AppForge app.json.
//
//   node bin/plan.js profiles/sweet-juniper-bakehouse [--draft] [--app-id-prefix com.vexx] [--max-modules 12]
//
// --draft plans even if the owner hasn't confirmed yet (for previews; the brief is marked DRAFT).
import path from 'node:path';
import { planFeatures, buildAppBrief } from '../src/index.js';
import { parseArgs, readJson, writeFile, fail, profilePath } from './_cli.js';

const args = parseArgs();
const file = profilePath(args._[0]);
const profile = readJson(file);
const dir = path.dirname(file);

const plan = await planFeatures(profile, { allowUnconfirmed: !!args.draft, maxModules: args['max-modules'] ? Number(args['max-modules']) : undefined });
writeFile(path.join(dir, 'plan.json'), plan);
if (plan.blocked) fail(`Plan saved, but the app can't be built yet:\n  - ${plan.blockers.join('\n  - ')}\n  Run bin/confirm.js first, or pass --draft for a preview.`);

let brief;
try { brief = await buildAppBrief(profile, plan, { appIdPrefix: args['app-id-prefix'] }); }
catch (e) { fail(e.message); }
const draft = !profile.owner_confirmed?.confirmed;
writeFile(path.join(dir, 'brief.md'), (draft ? '> DRAFT: the owner has not confirmed this profile yet.\n\n' : '') + brief.prompt);
writeFile(path.join(dir, 'app.json'), brief.manifest);

console.log(`\n✔ ${plan.business_name}: ${plan.modules.length} modules`);
for (const m of plan.modules) console.log(`  - ${m.name.padEnd(12)} ${m.mode === 'deep_link' ? `→ ${m.tool.provider || m.tool.url}` : 'native'}${m.data_ready ? '' : `  (needs: ${m.missing.join(', ')})`}`);
console.log(`  tabs: ${plan.navigation.tabs.join(' | ')}`);
for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
if (plan.suggested.length) console.log(`  could add later: ${plan.suggested.map((m) => m.name).join(', ')}`);
console.log(`\nSaved plan.json, brief.md, app.json in ${dir}/`);
console.log(`Next: paste brief.md into the AppForge builder, or run node bin/generate.js ${dir}\n`);
