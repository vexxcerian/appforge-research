#!/usr/bin/env node
// Serves the repo so the web screen can load src/, prompts/, schema/ and config/.
//   node bin/serve.js [--port 5174]   then open http://localhost:5174/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_cli.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(parseArgs().port || process.env.PORT || 5174);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ALLOWED = ['web', 'src', 'prompts', 'schema', 'config', 'examples'];

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/web') { res.writeHead(302, { location: '/web/' }); res.end(); return; }
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  const file = path.join(ROOT, rel.endsWith('/') || rel === 'web' ? path.join(rel, 'index.html') : rel);
  if (!file.startsWith(ROOT + path.sep) || !ALLOWED.includes(rel.split(/[/\\]/)[0])) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`AppForge Research: http://localhost:${PORT}/`));
