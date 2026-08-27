/**
 * SOI Duet coupling (soi-spec §3.1) — personification via the owner's
 * Duet Protocol (P/M/E pools over one sparse reservoir).
 *
 * Seeding: the twin's Cognitive Profile / OKF persona vector (64-d) derives
 * per-pool bias currents and initial edge gains. Re-seeding resets plasticity,
 * never the graph.
 *
 * Fingerprint: persona_drift = distance between the current r_P/r_M ratio and
 * the ratio recorded at seed time — measurable per-twin dynamics.
 */
import { xxhash32 } from './encode.js';

export const PERSONA_VEC_DIM = 64;

/** Deterministic PRNG (mulberry32) — SOI never uses Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Embed a Duet Cognitive Profile into a deterministic 64-d persona vector. */
export function profileToPersonaVector(profile: {
  name?: string; bio?: string; worldview?: string;
  coreBeliefs?: string[]; linguisticPatterns?: string[];
  communicationStyle?: { formality?: number; verbosity?: number; technicality?: number; preferredTone?: string };
}): Float32Array {
  const vec = new Float32Array(PERSONA_VEC_DIM);
  const parts: string[] = [
    profile.name || '', profile.bio || '', profile.worldview || '',
    (profile.coreBeliefs || []).join('|'), (profile.linguisticPatterns || []).join('|'),
    `${profile.communicationStyle?.formality ?? 0.5}`,
    `${profile.communicationStyle?.verbosity ?? 0.5}`,
    `${profile.communicationStyle?.technicality ?? 0.5}`,
    profile.communicationStyle?.preferredTone || ''
  ];
  for (let d = 0; d < PERSONA_VEC_DIM; d++) {
    let acc = 0;
    for (const part of parts) acc = (acc + xxhash32(part, (d * 0x85ebca77) >>> 0)) % 0xffffffff;
    vec[d] = ((acc % 20000) / 10000) - 1; // [-1, 1)
  }
  return vec;
}

export interface SeedResult {
  /** per-pool bias currents added to I_syn every tick */
  biasPrimary: Float32Array;
  biasMeta: Float32Array;
  biasExpressive: Float32Array;
  /** global multiplicative gain applied to edge weights at seed time */
  edgeGain: number;
}

/**
 * Derive pool bias currents from the persona vector. Bias amplitude is small:
 * personas modulate dynamics measurably but never saturate the reservoir.
 */
export function deriveSeed(vec: Float32Array, nPrimary: number, nMeta: number, nExpressive: number, twinSeed: number): SeedResult {
  const rnd = mulberry32(twinSeed);
  const makeBias = (n: number, salt: number): Float32Array => {
    const bias = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let d = 0; d < PERSONA_VEC_DIM; d++) {
        // deterministic pseudo-random projection weight per (neuron, dim)
        dot += vec[d] * (((xxhash32(`${salt}:${i}:${d}`, twinSeed) % 1000) / 500) - 1);
      }
      bias[i] = Math.max(-0.35, Math.min(0.35, dot / PERSONA_VEC_DIM));
    }
    return bias;
  };
  void rnd;
  return {
    biasPrimary: makeBias(nPrimary, 1),
    biasMeta: makeBias(nMeta, 2),
    biasExpressive: makeBias(nExpressive, 3),
    edgeGain: 0.9 + ((xxhash32('gain', twinSeed) % 200) / 1000) // 0.9..1.1
  };
}
