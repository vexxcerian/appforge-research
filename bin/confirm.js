#!/usr/bin/env node
// Owner review: answer the profile's questions, then record ownership verification.
//
//   node bin/confirm.js profiles/sweet-juniper-bakehouse                  (asks each question)
//   node bin/confirm.js profiles/sweet-juniper-bakehouse --answers a.json  (answers from a file)
//   ... --verified code_to_listed_phone                                   (record how ownership was checked)
//
// answers.json: [{ "field": "hours", "value": "Tue-Sat 7am-2pm" }, { "field": "brand.colors", "accepted": true }]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { applyOwnerAnswers, buildReview, markOwnershipVerified, verificationOptions } from '../src/index.js';
import { parseArgs, readJson, writeFile, fail, profilePath } from './_cli.js';

const args = parseArgs();
const file = profilePath(args._[0]);
let profile = readJson(file);
const review = buildReview(profile);

let answers = [];
if (args.answers) {
  answers = readJson(args.answers);
  if (!Array.isArray(answers)) fail('answers file must be a JSON list.');
} else if (review.questions.length) {
  if (!process.stdin.isTTY) fail('No terminal to ask in. Pass --answers answers.json.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nReview for ${review.business}. Press Enter to accept what research found, type a new value, or "skip".\n`);
  for (const q of review.questions) {
    const hint = q.input === 'yes_no' ? ' (yes/no)' : '';
    const found = q.current_value ? `\n  found: ${q.current_value}` : '';
    const reply = (await rl.question(`${q.question}${hint}${found}\n> `)).trim();
    if (/^skip$/i.test(reply)) continue;
    if (q.input === 'yes_no') answers.push({ field: q.field, value: /^n/i.test(reply) ? false : true, accepted: !/^n/i.test(reply) });
    else if (!reply) { if (q.current_value) answers.push({ field: q.field, accepted: true }); }
    else answers.push({ field: q.field, value: reply });
  }
  rl.close();
}

const { profile: updated, identityRejected, remaining } = applyOwnerAnswers(profile, answers);
profile = updated;
if (args.verified) {
  const methods = verificationOptions(profile).map((o) => o.method);
  if (!methods.includes(args.verified)) fail(`--verified must be one of: ${methods.join(', ')}`);
  profile = markOwnershipVerified(profile, args.verified);
}

const backup = file.replace(/\.json$/, '.before-review.json');
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
writeFile(file, profile);

if (identityRejected) {
  console.log('\n✖ Owner says this is not their business. Re-run research with a website, phone or Google Maps link to pin it down.\n');
  process.exit(2);
}
console.log(`\n✔ Saved ${file}`);
if (remaining.length) console.log(`  ${remaining.length} questions still open: ${remaining.map((q) => q.field).join(', ')}`);
else console.log('  Owner confirmed the profile.');
if (!profile.owner_confirmed.ownership_verified) console.log(`  Ownership not verified yet. Options: ${verificationOptions(profile).map((o) => o.method).join(', ')} (pass --verified <method>).`);
console.log(`\nNext: node bin/plan.js ${path.dirname(file)}\n`);
