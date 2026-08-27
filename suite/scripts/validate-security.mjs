#!/usr/bin/env node
/**
 * Static security validation for the OpenWorker harness (srs FR-K*, NFR-8/9).
 *
 * Gates:
 *  S1  no hardcoded API keys / tokens / private keys in dist
 *  S2  no telemetry beacons — outbound http(s) limited to the release feed
 *      and provider endpoints already owned by the engine
 *  S3  vault + SOI checkpoints use AES-256-GCM with SHA-256 integrity
 *  S4  secret/key files are written mode 0o600
 *  S5  dashboard is loopback-only by default; non-loopback requires a token
 *  S6  secrets are redacted before printing engine/error strings
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const findings = [];
const add = (id, file, msg) => findings.push({ id, file, msg });

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.js')) yield p;
  }
}

const distDir = join(root, 'dist');
const files = [...walk(distDir)];

/* S1 — hardcoded credentials */
const SECRET_PATTERNS = [
  [/sk-[a-zA-Z0-9]{20,}/, 'OpenAI-style key'],
  [/sk-ant-[a-zA-Z0-9-]{20,}/, 'Anthropic key'],
  [/ghp_[A-Za-z0-9]{30,}/, 'GitHub PAT'],
  [/gho_[A-Za-z0-9]{30,}/, 'GitHub OAuth token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token']
];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(src)) add('S1', relative(root, f), `possible ${label} committed in build output`);
  }
}

/* S2 — telemetry: every outbound URL must be an expected host */
const ALLOWED_HOSTS = [
  'releases.openworker.dev',            // FR-D3 update feed
  'api.openai.com', 'api.anthropic.com', // delegated to engine providers layer
  'openrouter.ai', 'generativelanguage.googleapis.com', 'api.cohere.com',
  'registry.npmjs.org',
  // reach v2 backends (docs/architecture.md §1 ADAPTERS row)
  'r.jina.ai', 'api.github.com', 'cli.github.com', 'hnrss.org',
  // reach doctor connectivity probes
  'example.com',
  // loopback dashboard URLs printed by the CLI (not outbound)
  '127.0.0.1', 'localhost',
  // XML namespace identifiers embedded in DOCX/XLSX artifact templates — never fetched
  'www.w3.org', 'schemas.openxmlformats.org'
];
const URL_RE = /https?:\/\/([a-z0-9.-]+)/gi;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = URL_RE.exec(src))) {
    if (!ALLOWED_HOSTS.includes(m[1].toLowerCase())) {
      add('S2', relative(root, f), `unexpected outbound host "${m[1]}"`);
    }
  }
}

/* S3 — crypto scheme present where required */
const vaultSrc = readFileSync(join(distDir, 'vault.js'), 'utf8');
if (!vaultSrc.includes("'aes-256-gcm'")) add('S3', 'dist/vault.js', 'vault must use AES-256-GCM');
const persistSrc = readFileSync(join(distDir, 'soi', 'persist.js'), 'utf8');
if (!persistSrc.includes("'aes-256-gcm'")) add('S3', 'dist/src/soi/persist.js', 'SOI checkpoints must use AES-256-GCM');
if (!persistSrc.includes("createHash('sha256')")) add('S3', 'dist/src/soi/persist.js', 'SOI checkpoints must record SHA-256 integrity');

/* S4 — restrictive file modes on secret stores */
for (const [file, label] of [['vault.js', 'vault'], ['soi/persist.js', 'SOI checkpoint']]) {
  const src = readFileSync(join(distDir, ...file.split('/')), 'utf8');
  const writesSecret = /writeFileSync/.test(src);
  const hasMode = /mode:\s*0o600/.test(src);
  if (writesSecret && !hasMode) add('S4', file, `${label} writes lack mode 0o600`);
}

/* S5 — loopback default + mandatory token off-loopback */
const serverSrc = readFileSync(join(distDir, 'server.js'), 'utf8');
if (!/127\.0\.0\.1|::1|localhost/.test(serverSrc)) add('S5', 'dist/server.js', 'no loopback default found');
if (!/x-openworker-token/.test(serverSrc)) add('S5', 'dist/server.js', 'token header check missing');

/* S6 — redaction used for error/log surfaces */
const cliSrc = readFileSync(join(distDir, 'cli.js'), 'utf8');
if (!cliSrc.includes('redactSecrets')) add('S6', 'dist/cli.js', 'CLI output not passed through redactSecrets');

if (findings.length) {
  console.error(`security validation FAILED — ${findings.length} finding(s):`);
  for (const { id, file, msg } of findings) console.error(`  [${id}] ${file}: ${msg}`);
  process.exit(1);
}
console.log(`security validation OK — ${files.length} modules checked against gates S1-S6`);
