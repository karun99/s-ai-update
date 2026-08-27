/**
 * Portable tsc launcher — prefers the classic JS compiler (TypeScript < 7).
 * TS >= 7 ships native binaries that cannot exec from noexec mounts
 * (e.g. Android shared storage), so we search known-good JS copies first.
 *
 * Override with TSC_PATH=/path/to/typescript/lib/tsc.js
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

/** Returns the version of the typescript package that owns a tsc.js path. */
function tsVersion(tscPath) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dirname(tscPath), '../package.json'), 'utf8'));
    return parseInt(String(pkg.version).split('.')[0], 10);
  } catch {
    return 0;
  }
}

function isJsCompiler(tscPath) {
  return existsSync(tscPath) && tsVersion(tscPath) > 0 && tsVersion(tscPath) < 7;
}

const candidates = [
  process.env.TSC_PATH,
  resolve(here, '../node_modules/typescript/lib/tsc.js'),
  resolve(here, '../../node_modules/typescript/lib/tsc.js'),
  '/usr/local/lib/node_modules/typescript/lib/tsc.js',
  '/data/data/com.termux/files/usr/lib/node_modules/netlify-cli/node_modules/typescript/lib/tsc.js'
].filter(Boolean);

let tsc = candidates.find(isJsCompiler);
if (!tsc) {
  // Fall back to any available tsc (native TS7 works on normal filesystems)
  tsc = candidates.find(p => existsSync(p));
}
if (!tsc) {
  console.error('scripts/tsc.mjs: no TypeScript compiler found; npm i -D typescript@5 or set TSC_PATH');
  process.exit(2);
}

const result = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
