// Shared helpers for the command-line tools.
import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    const next = argv[i + 1];
    if (inline !== undefined) out[key] = inline;
    else if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`Could not read ${file}: ${e.message}`); }
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export function apiOptions(args) {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: args['base-url'] || process.env.ANTHROPIC_BASE_URL || undefined,
    apiVersion: args['api-version'] || undefined,
  };
}

/** Accepts a profile.json path or the folder that holds it. */
export function profilePath(p) {
  if (!p) fail('Pass the profile folder or profile.json path.');
  return fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'profile.json') : p;
}
