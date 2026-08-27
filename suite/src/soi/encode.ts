/**
 * SOI encoder (soi-spec §4) — deterministic token -> spike trains.
 *
 *   token -> h1,h2,h3 = xxhash32(seed,k)*3 mod N_in; spikes at t, t+2, t+4
 *
 * Zero dependencies, plain TypeScript, deterministic given (seed, text).
 */

/** 32-bit rotate left (Math.rotl is not yet in the ES2022 lib). */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** xxHash32 — compact, dependency-free, well-distributed, stable across platforms. */
export function xxhash32(input: string, seed = 0): number {
  const PRIME32_1 = 0x9e3779b1;
  const PRIME32_2 = 0x85ebca77;
  const PRIME32_3 = 0xc2b2ae35;
  const PRIME32_4 = 0x27d4eb2f;
  const PRIME32_5 = 0x165667b1;

  const bytes = Buffer.from(input, 'utf8');
  let i = 0;
  const len = bytes.length;
  let h32: number;

  if (len >= 16) {
    let v1 = (seed + PRIME32_1 + PRIME32_2) >>> 0;
    let v2 = (seed + PRIME32_2) >>> 0;
    let v3 = (seed + 0) >>> 0;
    let v4 = (seed - PRIME32_1) >>> 0;
    const limit = len - 16;
    do {
      v1 = Math.imul(rotl(v1 + Math.imul(bytes.readUInt32LE(i) * PRIME32_2, 13), 15), PRIME32_1);
      i += 4;
      v2 = Math.imul(rotl(v2 + Math.imul(bytes.readUInt32LE(i) * PRIME32_2, 13), 15), PRIME32_1);
      i += 4;
      v3 = Math.imul(rotl(v3 + Math.imul(bytes.readUInt32LE(i) * PRIME32_2, 13), 15), PRIME32_1);
      i += 4;
      v4 = Math.imul(rotl(v4 + Math.imul(bytes.readUInt32LE(i) * PRIME32_2, 13), 15), PRIME32_1);
      i += 4;
    } while (i <= limit);
    h32 = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h32 = (seed + PRIME32_5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;
  let remaining = len - i;
  while (remaining >= 4) {
    h32 = (h32 + Math.imul(bytes.readUInt32LE(i) * PRIME32_3, 0)) >>> 0;
    h32 = Math.imul(rotl(h32, 17), PRIME32_4);
    i += 4;
    remaining -= 4;
  }
  while (remaining > 0) {
    h32 = (h32 + bytes[i] * PRIME32_5) >>> 0;
    h32 = Math.imul(rotl(h32, 11), PRIME32_2);
    i++;
    remaining--;
  }

  h32 ^= h32 >>> 15;
  h32 = Math.imul(h32, PRIME32_2);
  h32 ^= h32 >>> 13;
  h32 = Math.imul(h32, PRIME32_3);
  h32 ^= h32 >>> 16;
  return h32 >>> 0;
}

export interface SpikeTrain {
  /** bin index in [0, N_in) */
  bin: number;
  /** tick offset within the cycle when the spike arrives */
  tick: number;
}

/**
 * Encode one token into 3 hash-bin spikes arriving at ticks t, t+2, t+4.
 * Deterministic for (seed, token).
 */
export function encodeToken(token: string, nIn: number, seed: number): SpikeTrain[] {
  const out: SpikeTrain[] = [];
  for (let k = 0; k < 3; k++) {
    const h = xxhash32(token, (seed ^ (k * 0x9e3779b9)) >>> 0);
    out.push({ bin: (Math.imul(h, 3) >>> 0) % nIn, tick: k * 2 });
  }
  return out;
}

/** Tokenize text the same way everywhere (lowercase word split). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9']+/i).filter(t => t.length > 0).slice(0, 256);
}

/** Encode a whole text; tick offsets stay inside one cycle (mod cycleTicks). */
export function encodeText(text: string, nIn: number, seed: number, cycleTicks: number): SpikeTrain[] {
  const tokens = tokenize(text);
  const trains: SpikeTrain[] = [];
  tokens.forEach((tok, idx) => {
    const base = (idx * 4) % cycleTicks;
    for (const sp of encodeToken(tok, nIn, seed)) {
      trains.push({ bin: sp.bin, tick: (base + sp.tick) % cycleTicks });
    }
  });
  return trains;
}
