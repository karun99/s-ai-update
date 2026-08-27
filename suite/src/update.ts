/**
 * Update feed (FR-D2, FR-D3) — signed release-feed JSON + SHA256SUMS.
 *
 * Feed format:
 * {
 *   "releases": [{
 *     "version": "0.2.0", "channel": "stable"|"next", "date": "...",
 *     "notes": "...",
 *     "artifacts": [{ "name": "openworker-linux-x64.tar.gz", "url": "...", "sha256": "..." }]
 *   }]
 * }
 * The feed JSON is signed with a detached Ed25519 signature over the exact
 * bytes; the public key ships with the installation. `openworker update
 * --check` prints the diff; `--apply` downloads + verifies checksums and
 * reports where the artifact was staged (no in-place self-replace in v1).
 */
import { createHash, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendLog } from './config.js';

export interface ReleaseArtifact { name: string; url: string; sha256: string; }

export interface Release {
  version: string;
  channel: 'stable' | 'next' | 'prerelease';
  date: string;
  notes?: string;
  artifacts: ReleaseArtifact[];
}

export interface ReleaseFeed { releases: Release[]; }

export const DEFAULT_FEED_URL = 'https://releases.openworker.dev/feed.json';

export function currentVersion(): string {
  try {
    // package.json lives two levels up from dist/src/update.js at runtime,
    // and at suite/ root during tests.
    for (const rel of ['../../package.json', '../../../package.json']) {
      try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), rel);
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch { /* keep trying */ }
    }
    return '0.0.0';
  } catch { return '0.0.0'; }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Verify an Ed25519 detached signature over the feed's exact bytes. */
export function verifyFeedSignature(feedBytes: Buffer, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(null, feedBytes, publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

export async function fetchFeed(feedUrl = DEFAULT_FEED_URL, fetchImpl: typeof fetch = fetch): Promise<{ feed: ReleaseFeed; bytes: Buffer }> {
  const res = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { feed: JSON.parse(bytes.toString('utf8')) as ReleaseFeed, bytes };
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestStable?: Release;
  latestNext?: Release;
  upToDate: boolean;
}

export function evaluateUpdate(feed: ReleaseFeed, channel: 'stable' | 'next' = 'stable'): UpdateCheckResult {
  const current = currentVersion();
  const pool = feed.releases ?? [];
  const byNewest = (a: Release, b: Release): number => compareVersions(b.version, a.version);
  const latestStable = pool.filter(r => r.channel === 'stable').sort(byNewest)[0];
  const latestNext = pool.filter(r => r.channel === 'next').sort(byNewest)[0];
  const target = channel === 'next' ? (latestNext ?? latestStable) : latestStable;
  return {
    currentVersion: current,
    latestStable,
    latestNext,
    upToDate: !target || compareVersions(current, target.version) >= 0
  };
}

export interface ApplyResult { ok: boolean; stagedTo?: string; error?: string; verified: Array<string>; }

/**
 * Download artifacts of a release, verify each sha256, stage under dir.
 * v1 does NOT replace the running installation — it stages + prints guidance.
 */
export async function applyRelease(release: Release, stageDir: string, fetchImpl: typeof fetch = fetch): Promise<ApplyResult> {
  const verified: Array<string> = [];
  if (!existsSync(stageDir)) mkdirSync(stageDir, { recursive: true });
  for (const artifact of release.artifacts) {
    const res = await fetchImpl(artifact.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return { ok: false, verified, error: `download failed ${artifact.name}: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== artifact.sha256) {
      appendLog(`update checksum mismatch ${artifact.name}`);
      return { ok: false, verified, error: `sha256 mismatch for ${artifact.name} (expected ${artifact.sha256}, got ${actual})` };
    }
    const dest = join(stageDir, artifact.name);
    writeFileSync(dest, buf);
    verified.push(dest);
  }
  appendLog(`update staged ${release.version}: ${verified.length} artifacts`);
  return { ok: true, stagedTo: stageDir, verified };
}
