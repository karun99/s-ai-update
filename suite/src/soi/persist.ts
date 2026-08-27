/**
 * SOI persistence (soi-spec §8).
 *
 * state.bin layout: header magic `SOI1`, u32 version, then raw typed arrays
 * and scalars in fixed order. Checkpoints: rolling 3, AES-256-GCM encrypted
 * under OKF key material with SHA-256 integrity recorded alongside.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAGIC_SOI1 = 0x314f53;   // 'ISO' + '1' packed little-endian read of 'SOI1'
const STATE_VERSION = 1;
const CHECKPOINT_MAGIC = 'OWSOICKPT1';
export const CHECKPOINT_COUNT = 3;

export interface PersistedTrace {
  ts: string;
  role: 'USER' | 'AGENT';
  summary: string;
  salience: number;
  signals: unknown;
}

export interface SoiSnapshot {
  cfg: {
    mode: 'off' | 'passive' | 'active';
    neurons: { primary: number; meta: number; expressive: number };
    connectivity: number;
    tick_ms: number;
    cycle_ticks: number;
    slice_ticks: number;
    stdp: { ap: number; am: number; taup: number; taum: number };
    consolidate: { every_hours: number; max_traces: number };
    seed: number;
  };
  twinId: string;
  tickCounter: number;
  cycleCount: number;
  calibrationCyclesLeft: number;
  baselineMean: number[];
  baselineStd: number[];
  ratioMean: number;
  ratioStd: number;
  seededRatio: number;
  ratioDeviations: number[];
  personaVec: number[] | null;
  bias: number[] | null;
  data: Float32Array;
  v: Float32Array;
  theta: Float32Array;
  refractory: Int32Array;
  rateHz: Float32Array;
  lastPreTick: Int32Array;
  lastPostTick: Int32Array;
  traces: PersistedTrace[];
}

/** Serialize a snapshot to state.bin bytes. */
export function serializeSnapshot(snap: SoiSnapshot): Buffer {
  const headerJson = JSON.stringify({
    twinId: snap.twinId,
    cfg: snap.cfg,
    tickCounter: snap.tickCounter,
    cycleCount: snap.cycleCount,
    calibrationCyclesLeft: snap.calibrationCyclesLeft,
    baselineMean: snap.baselineMean,
    baselineStd: snap.baselineStd,
    ratioMean: snap.ratioMean,
    ratioStd: snap.ratioStd,
    seededRatio: snap.seededRatio,
    ratioDeviations: snap.ratioDeviations,
    personaVec: snap.personaVec,
    bias: snap.bias,
    traces: snap.traces
  });
  const headerBuf = Buffer.from(headerJson, 'utf8');

  const arrays: Buffer[] = [snap.data, snap.v, snap.theta, snap.refractory, snap.rateHz, snap.lastPreTick, snap.lastPostTick]
    .map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength));

  const total =
    4 +          // magic
    4 +          // version
    4 +          // header length
    headerBuf.length +
    arrays.reduce((s, b) => s + b.length, 0);

  const out = Buffer.alloc(total);
  let off = 0;
  out.writeUInt32LE(MAGIC_SOI1, off); off += 4;
  out.writeUInt32LE(STATE_VERSION, off); off += 4;
  out.writeUInt32LE(headerBuf.length, off); off += 4;
  headerBuf.copy(out, off); off += headerBuf.length;
  for (const a of arrays) { a.copy(out, off); off += a.length; }
  return out;
}

/** Parse state.bin bytes back into a snapshot (arrays copied). */
export function parseSnapshot(buf: Buffer): SoiSnapshot {
  let off = 0;
  const magic = buf.readUInt32LE(off); off += 4;
  if (magic !== MAGIC_SOI1) throw new Error('state.bin bad magic — not an SOI snapshot');
  const version = buf.readUInt32LE(off); off += 4;
  if (version !== STATE_VERSION) throw new Error(`state.bin unsupported version ${version}`);
  const headerLen = buf.readUInt32LE(off); off += 4;
  const header = JSON.parse(buf.subarray(off, off + headerLen).toString('utf8'));
  off += headerLen;

  const slice = (ctor: typeof Float32Array | typeof Int32Array): Float32Array | Int32Array => {
    const len = buf.readUInt32LE(off); off += 4;
    const arr = new (ctor as any)(len);
    Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).set(buf.subarray(off, off + len * (arr instanceof Float32Array ? 4 : 4)));
    // note: Int32Array elements are also 4 bytes
    off += len * 4;
    return arr;
  };

  const data = slice(Float32Array) as Float32Array;
  const v = slice(Float32Array) as Float32Array;
  const theta = slice(Float32Array) as Float32Array;
  const refractory = slice(Int32Array) as Int32Array;
  const rateHz = slice(Float32Array) as Float32Array;
  const lastPreTick = slice(Int32Array) as Int32Array;
  const lastPostTick = slice(Int32Array) as Int32Array;

  return {
    ...header,
    baselineMean: header.baselineMean ?? [0, 0, 0],
    baselineStd: header.baselineStd ?? [1e-6, 1e-6, 1e-6],
    ratioMean: header.ratioMean ?? 1,
    ratioStd: header.ratioStd ?? 1e-6,
    seededRatio: header.seededRatio ?? 1,
    ratioDeviations: header.ratioDeviations ?? [],
    personaVec: header.personaVec ?? null,
    bias: header.bias ?? null,
    traces: header.traces ?? [],
    data, v, theta, refractory, rateHz, lastPreTick, lastPostTick
  };
}

/* ------------------------- encrypted rolling checkpoints -------------------- */

function checkpointKey(): Buffer {
  // Share the vault's OKF master key material (FR-K1) so SOI checkpoints and
  // keys.enc derive from one local secret. Pure fs access keeps this module
  // free of app-config imports.
  let keyB64: string | null = null;
  try {
    const masterFile = join(process.env.OPENWORKER_DIR || join(process.env.HOME || '', '.openworker'), '.vault-master');
    if (existsSync(masterFile)) keyB64 = readFileSync(masterFile, 'utf8').trim();
  } catch { keyB64 = null; }
  if (!keyB64) keyB64 = randomBytes(32).toString('base64');
  return createHash('sha256').update(`soi-checkpoint:${keyB64}`).digest();
}

interface CheckpointMeta { magic: string; ts: number; sha256: string; }

export async function writeCheckpoint(stateBytes: Buffer, dir: string): Promise<void> {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = listCheckpoints(dir);
  const nextIndex = existing.length >= CHECKPOINT_COUNT ? (existing[existing.length - 1].index + 1) % CHECKPOINT_COUNT : existing.length;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', checkpointKey(), iv);
  const enc = Buffer.concat([cipher.update(stateBytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const sha256 = createHash('sha256').update(enc).digest('hex');
  writeFileSync(join(dir, `checkpoint-${nextIndex}.bin`), enc, { mode: 0o600 });
  writeFileSync(join(dir, `checkpoint-${nextIndex}.meta`), JSON.stringify({
    magic: CHECKPOINT_MAGIC, ts: Date.now(), sha256, iv: iv.toString('base64'), tag: tag.toString('base64')
  } satisfies CheckpointMeta & { iv: string; tag: string }), { mode: 0o600 });

  // keep only the newest CHECKPOINT_COUNT by timestamp
  const all = listCheckpoints(dir)
    .map(c => ({ c, ts: safeTs(c.metaPath) }))
    .sort((a, b) => b.ts - a.ts);
  for (const { c } of all.slice(CHECKPOINT_COUNT)) {
    rmSync(c.binPath, { force: true });
    rmSync(c.metaPath, { force: true });
  }
}

function safeTs(metaPath: string): number {
  try {
    return (JSON.parse(readFileSync(metaPath, 'utf8')) as CheckpointMeta).ts || 0;
  } catch { return 0; }
}

export function listCheckpoints(dir: string): Array<{ index: number; metaPath: string; binPath: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ index: number; metaPath: string; binPath: string }> = [];
  for (const f of readdirSync(dir)) {
    const m = f.match(/^checkpoint-(\d+)\.meta$/);
    if (m) out.push({ index: Number(m[1]), metaPath: join(dir, f), binPath: join(dir, `checkpoint-${m[1]}.bin`) });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function readLatestCheckpoint<T>(dir: string, revive: (buf: Buffer) => T): T {
  const checkpoints = listCheckpoints(dir).filter(c => existsSync(c.binPath));
  if (checkpoints.length === 0) throw new Error(`no SOI checkpoints found in ${dir}`);
  // newest first by ts
  const sorted = checkpoints.map(c => ({ c, meta: JSON.parse(readFileSync(c.metaPath, 'utf8')) as CheckpointMeta & { iv: string; tag: string } }))
    .sort((a, b) => b.meta.ts - a.meta.ts);
  let lastError: Error | null = null;
  for (const { c, meta } of sorted) {
    try {
      const enc = readFileSync(c.binPath);
      const actual = createHash('sha256').update(enc).digest('hex');
      if (actual !== meta.sha256) throw new Error('SHA-256 integrity check failed');
      const decipher = createDecipheriv('aes-256-gcm', checkpointKey(), Buffer.from(meta.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
      return revive(plain);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new Error(`all SOI checkpoints failed integrity/decryption: ${lastError?.message}`);
}
