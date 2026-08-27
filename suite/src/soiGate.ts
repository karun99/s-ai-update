/**
 * SOI gate (FR-S2, FR-S8) — off-mode purity.
 *
 * This module is the ONLY harness entry into SOI. It reads soi.config.json
 * directly (no import of ./soi/*), so when the file is absent or mode==="off"
 * the SOI module is never evaluated and carries zero runtime cost.
 * Verified by test/soi-offpurity.test.js via module-load tracing.
 *
 * All UI surfaces that expose SOI data carry the "simulated" label (SRS §2.2(5)).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SoiConfig } from './soi/core.js';

export interface SoiGateConfig extends Partial<SoiConfig> { mode?: 'off' | 'passive' | 'active'; }

export const SIMULATED_LABEL = 'SOI is simulated, bio-inspired engineering (reservoir computing) — not biological computation.';

export function soiConfigPath(dir?: string): string {
  const base = dir ?? process.env.OPENWORKER_DIR ?? join(process.env.HOME || '', '.openworker');
  return join(base, 'soi.config.json');
}

/** Read raw config file or null when absent (= module must never load). */
export function readSoiGateConfig(dir?: string): SoiGateConfig | null {
  const path = soiConfigPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SoiGateConfig;
  } catch {
    return null; // corrupt config = off (fail-safe)
  }
}

export function resolveSoiMode(dir?: string): 'off' | 'passive' | 'active' {
  const cfg = readSoiGateConfig(dir);
  if (!cfg) return 'off';
  return cfg.mode === 'active' ? 'active' : cfg.mode === 'passive' ? 'passive' : 'off';
}

export interface LoadedSoi {
  core: import('./soi/core.js').SoiCore;
  signalsLabel: string;
}

/**
 * Dynamically import the SOI core only when enabled. Returns null in off mode
 * — callers must treat that as "no SOI" without touching the module graph.
 */
export async function loadSoiIfEnabled(twinId = 'default', dir?: string): Promise<LoadedSoi | null> {
  const gateCfg = readSoiGateConfig(dir);
  if (!gateCfg || gateCfg.mode === 'off') return null;
  const { SoiCore } = await import('./soi/core.js');
  const core = new SoiCore(gateCfg, twinId);
  return { core, signalsLabel: SIMULATED_LABEL };
}
