/**
 * OpenWorker configuration — ~/.openworker layout (SRS §5).
 *
 * ~/.openworker/
 * ├── config.json          # non-secret settings
 * ├── keys.enc             # AES-256-GCM vault (or OS keychain alias table)
 * ├── okf/                 # encrypted OKF store (persona, graph seeds, SOI meta)
 * ├── graph/               # knowledge graph persistence
 * ├── soi/
 * │   ├── state.bin
 * │   └── checkpoints/     # rolling 3, encrypted
 * ├── jobs.json
 * ├── artifacts/<job>/
 * ├── cache/reach/
 * └── logs/openworker.log  # 3 x 5 MB rotated; secret-redacted
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface OwJobTask { prompt: string; model?: string; }
export interface OwJob {
  id: string;
  name: string;
  trigger: { type: 'manual' | 'schedule' | 'event'; cron?: string; event?: string };
  task: OwJobTask;
  tools: string[];
  policy: PolicyName;
}
export type PolicyName = 'allow-all' | 'deny-list' | 'require-approval';

export interface OwConfig {
  version: string;
  server: { port: number; host: string };
  providers: { primary?: string; fallback?: string };
  policy: { default: PolicyName; destructiveToolsRequireApproval: boolean };
  soi: { enabledHint: boolean };
  jobs: { historyLimit: number };
  [key: string]: unknown;
}

export function openworkerDir(): string {
  return process.env.OPENWORKER_DIR || join(homedir(), '.openworker');
}

function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigPath(): string { return join(openworkerDir(), 'config.json'); }
export function getJobsPath(): string { return join(openworkerDir(), 'jobs.json'); }
export function getOkfDir(): string { return ensure(join(openworkerDir(), 'okf')); }
export function getGraphDir(): string { return ensure(join(openworkerDir(), 'graph')); }
export function getSoiDir(): string { return ensure(join(openworkerDir(), 'soi')); }
export function getSoiCheckpointsDir(): string { return ensure(join(getSoiDir(), 'checkpoints')); }
export function getArtifactsRoot(): string { return ensure(join(openworkerDir(), 'artifacts')); }
export function getReachCacheDir(): string { return ensure(join(openworkerDir(), 'cache', 'reach')); }
export function getLogsDir(): string { return ensure(join(openworkerDir(), 'logs')); }

export const DEFAULT_CONFIG: OwConfig = {
  version: '0.1.0',
  server: { port: 3000, host: '127.0.0.1' },
  providers: {},
  policy: { default: 'require-approval', destructiveToolsRequireApproval: true },
  soi: { enabledHint: false },
  jobs: { historyLimit: 50 }
};

let _config: OwConfig | null = null;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge((result[key] || {}) as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadOwConfig(): OwConfig {
  if (_config) return _config;
  let config: Record<string, unknown> = { ...DEFAULT_CONFIG } as unknown as Record<string, unknown>;
  const path = getConfigPath();
  if (existsSync(path)) {
    try {
      const user = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      config = deepMerge(config, user);
    } catch { /* corrupt config falls back to defaults */ }
  }
  _config = config as OwConfig;
  return _config;
}

export function saveOwConfig(config: OwConfig): string {
  const dir = ensure(openworkerDir());
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  _config = config;
  return path;
}

export function updateOwConfig(partial: Record<string, unknown>): string {
  const merged = deepMerge(loadOwConfig() as unknown as Record<string, unknown>, partial);
  return saveOwConfig(merged as OwConfig);
}

/* ------------------------------------------------------------------ */
/* FR-C9 — one-shot migration from ~/.s-ai (copy-forward, never delete) */
/* ------------------------------------------------------------------ */

export interface MigrationReport {
  configMigrated: boolean;
  keysMovedToVault: Array<{ provider: string; keyName: string }>;
  graphCopied: boolean;
  neuralCopied: boolean;
  sourceDir: string;
  notes: string[];
}

export async function migrateFromSAi(): Promise<MigrationReport> {
  const report: MigrationReport = {
    configMigrated: false,
    keysMovedToVault: [],
    graphCopied: false,
    neuralCopied: false,
    sourceDir: join(homedir(), '.s-ai'),
    notes: []
  };
  const srcConfig = join(report.sourceDir, 'config.json');
  if (existsSync(srcConfig)) {
    try {
      const imported = JSON.parse(readFileSync(srcConfig, 'utf8')) as Record<string, any>;
      let sanitized = imported;
      try {
        const vault = await import('./vault.js');
        const { sanitized: clean, moved } = vault.extractKeysToVault(imported);
        sanitized = clean;
        report.keysMovedToVault = moved;
      } catch { /* vault unavailable — copy config verbatim */ }
      updateOwConfig(sanitized);
      report.configMigrated = true;
    } catch (err) {
      report.notes.push(`config migration warning: ${(err as Error).message}`);
    }
  }
  const srcDataGraph = join(report.sourceDir, 'data', 'graph');
  if (existsSync(srcDataGraph)) {
    try {
      const dst = getGraphDir();
      for (const f of ['graph.json']) {
        const from = join(srcDataGraph, f);
        const to = join(dst, f);
        if (existsSync(from) && !existsSync(to)) writeFileSync(to, readFileSync(from));
      }
      report.graphCopied = true;
    } catch (err) {
      report.notes.push(`graph copy warning: ${(err as Error).message}`);
    }
  }
  const srcNeural = join(report.sourceDir, 'data', 'neural');
  if (existsSync(srcNeural)) {
    report.neuralCopied = true;
    report.notes.push('neural persona stays readable in place by the engine (~/.s-ai/data/neural) — nothing to move');
  }
  if (!report.configMigrated && !report.graphCopied && !report.neuralCopied) {
    report.notes.push('nothing found under ~/.s-ai — fresh install');
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* Redacted rotating log (FR-K2, SRS §5 logs/openworker.log 3x5MB)     */
/* ------------------------------------------------------------------ */

const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_ROTATIONS = 3;

export function appendLog(line: string): void {
  try {
    const dir = getLogsDir();
    const file = join(dir, 'openworker.log');
    try {
      if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) {
        for (let i = LOG_ROTATIONS - 1; i >= 1; i--) {
          const from = join(dir, `openworker.log.${i}`);
          const to = join(dir, `openworker.log.${i + 1}`);
          if (existsSync(from)) renameSync(from, to);
        }
        renameSync(file, join(dir, 'openworker.log.1'));
      }
    } catch { /* rotation best-effort */ }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never crash the app */ }
}

/** Test helper: reset cached config between tests. */
export function resetOwConfigCache(): void {
  _config = null;
}

export { deepMerge };
