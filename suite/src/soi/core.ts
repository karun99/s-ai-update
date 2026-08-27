/**
 * SOI core (soi-spec §3/§4/§6) — one sparse reservoir, three Duet pools.
 *
 *   POOL P (primary)    reacts to ingress immediately
 *   POOL M (meta)       receives delayed ingress copy (10-tick ring)
 *   POOL E (expressive) integrates both via association edges
 *
 * Cycle = 64 ticks @ 2 ms virtual, computed in 8-tick slices (event-loop safe).
 * Deterministic: mulberry32(seed) everywhere; typed arrays only; zero deps.
 * Budget gates (soi-spec §7): default 8192 neurons <= 6 MB arrays,
 * cycle <= 5 ms, consolidation <= 300 ms.
 */
import { encodeText, type SpikeTrain } from './encode.js';
import { integrate, homeostasis, DEFAULT_LIF } from './lif.js';
import { onPreSpike, onPostSpike, resetLastSpikeTicks, DEFAULT_STDP } from './stdp.js';
import { mulberry32, deriveSeed } from './duet.js';
import { serializeSnapshot, parseSnapshot, writeCheckpoint, readLatestCheckpoint, type SoiSnapshot } from './persist.js';
import { join } from 'node:path';
import { openworkerDir } from '../config.js';

export interface SoiNeuronsConfig { primary: number; meta: number; expressive: number; }

export interface SoiConfig {
  mode: 'off' | 'passive' | 'active';
  neurons: SoiNeuronsConfig;
  connectivity: number;
  tick_ms: number;
  cycle_ticks: number;
  slice_ticks: number;
  stdp: { ap: number; am: number; taup: number; taum: number };
  consolidate: { every_hours: number; max_traces: number };
  seed: number;
}

export const DEFAULT_SOI_CONFIG: SoiConfig = {
  mode: 'passive',
  neurons: { primary: 2730, meta: 2730, expressive: 2732 },
  connectivity: 0.005,
  tick_ms: 2,
  cycle_ticks: 64,
  slice_ticks: 8,
  stdp: { ap: 0.010, am: 0.008, taup: 10, taum: 10 },
  consolidate: { every_hours: 168, max_traces: 500 },
  seed: 0
};

export interface SoiSignals {
  confidence: number;
  novelty: number;
  bias_anomaly: boolean;
  salience: number;
  persona_drift: number;
}

export interface SoiTrace {
  ts: string;
  role: 'USER' | 'AGENT';
  summary: string;
  salience: number;
  signals: SoiSignals;
}

export interface SoiStats {
  neurons: number;
  synapses: number;
  bytes: number;
  cycles: number;
  traces: number;
  lastSignals: SoiSignals | null;
  twinId: string;
  mode: SoiConfig['mode'];
}

const INPUT_BINS = 1024;
const DELAY_TICKS = 10;
const IN_FANOUT = 12;

export class SoiCore {
  readonly cfg: SoiConfig;
  readonly twinId: string;

  private nP: number; private nM: number; private nE: number;
  private nTotal: number;

  // CSR topology (forward + reverse for STDP)
  private indptr!: Int32Array;
  private indices!: Uint32Array;
  private data!: Float32Array;
  private isInhibitory!: Uint8Array;
  private revIndptr!: Int32Array;
  private revIndices!: Uint32Array;
  private revEdgeId!: Int32Array;
  private synapses = 0;

  // state
  private v!: Float32Array;
  private theta!: Float32Array;
  private iSyn!: Float32Array;
  private refractory!: Int32Array;
  private rateAccum!: Float32Array;
  private rateHz!: Float32Array;
  private lastPreTick!: Int32Array;
  private lastPostTick!: Int32Array;

  // input projection (bins -> P and M pools), deterministic
  private inTargetsP!: Int32Array;   // INPUT_BINS * IN_FANOUT
  private inTargetsM!: Int32Array;

  // ingress ring for the fixed 10-tick P->M axonal delay
  private ring: number[][] = [];
  private ringPos = 0;
  private metaDelayed: number[] = [];

  // Duet seeding + baselines
  private personaVec!: Float32Array;
  private bias!: Float32Array; // full-length bias currents
  private baseline = { mean: new Float64Array(3), std: new Float64Array(3) };
  private ratioMean = 1; private ratioStd = 1e-6;
  private seededRatio = 1;
  private calibrationCyclesLeft = 0;
  private poolRates = new Float64Array(3);
  private prevPoolRates = new Float64Array(3);
  private ratioDeviations: number[] = [];

  private tickCounter = 0;
  private cycleCount = 0;
  private traces: SoiTrace[] = [];
  private lastSignals: SoiSignals | null = null;
  private rng: () => number;
  private pendingInput: Array<Array<number>> = []; // per-tick bin lists within cycle

  constructor(cfg: Partial<SoiConfig> = {}, twinId = 'default') {
    this.cfg = { ...DEFAULT_SOI_CONFIG, ...cfg, neurons: { ...DEFAULT_SOI_CONFIG.neurons, ...(cfg.neurons || {}) }, stdp: { ...DEFAULT_SOI_CONFIG.stdp, ...(cfg.stdp || {}) }, consolidate: { ...DEFAULT_SOI_CONFIG.consolidate, ...(cfg.consolidate || {}) } };
    if (this.cfg.seed === 0) this.cfg.seed = deriveTwinSeed(twinId);
    this.twinId = twinId;
    this.nP = this.cfg.neurons.primary;
    this.nM = this.cfg.neurons.meta;
    this.nE = this.cfg.neurons.expressive;
    this.nTotal = this.nP + this.nM + this.nE;
    if (this.nTotal > 102_400) throw new Error(`refusing to load ${this.nTotal} neurons (>102,400). Pass --unsafe-i-understand to override.`);
    this.rng = mulberry32(this.cfg.seed);
    this.buildTopology();
    this.allocateState();
    this.buildInputProjection();
    this.resetDynamics();
  }

  /* ------------------------------ topology ------------------------------ */

  private buildTopology(): void {
    // Directed Erdos-Renyi with p=connectivity over all ordered pairs,
    // built with a deterministic PRNG. Self-loops excluded.
    const p = this.cfg.connectivity;
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < this.nTotal; i++) {
      for (let j = 0; j < this.nTotal; j++) {
        if (i === j) continue;
        if (this.rng() < p) { src.push(i); dst.push(j); }
      }
    }
    this.synapses = src.length;
    const n = this.nTotal;
    this.indptr = new Int32Array(n + 1);
    this.indices = new Uint32Array(this.synapses);
    this.data = new Float32Array(this.synapses);
    this.isInhibitory = new Uint8Array(this.synapses);

    // bucket by source
    for (let i = 0; i < this.synapses; i++) this.indptr[src[i] + 1]++;
    for (let i = 0; i < n; i++) this.indptr[i + 1] += this.indptr[i];
    const cursor = Int32Array.from(this.indptr);
    for (let e = 0; e < this.synapses; e++) {
      const s = src[e];
      const pos = cursor[s]++;
      this.indices[pos] = dst[e];
      // 20% inhibitory sources -> fixed-strength negative edges
      if (((s * 2654435761) >>> 0) % 5 === 0) {
        this.isInhibitory[pos] = 1;
        this.data[pos] = -0.6;
      } else {
        this.isInhibitory[pos] = 0;
        this.data[pos] = 0.15 + this.rng() * 0.35;
      }
    }

    // reverse CSR for POST-spike STDP lookups
    this.revIndptr = new Int32Array(n + 1);
    for (let e = 0; e < this.synapses; e++) this.revIndptr[dst[e] + 1]++;
    for (let i = 0; i < n; i++) this.revIndptr[i + 1] += this.revIndptr[i];
    const rcursor = Int32Array.from(this.revIndptr);
    this.revIndices = new Uint32Array(this.synapses);
    this.revEdgeId = new Int32Array(this.synapses);
    for (let pos = 0; pos < this.synapses; pos++) {
      const t = this.indices[pos];
      const rpos = rcursor[t]++;
      this.revIndices[rpos] = src[pos];
      this.revEdgeId[rpos] = pos;
    }
  }

  private allocateState(): void {
    const n = this.nTotal;
    this.v = new Float32Array(n);
    this.theta = new Float32Array(n).fill(0.08);
    this.iSyn = new Float32Array(n);
    this.refractory = new Int32Array(n);
    this.rateAccum = new Float32Array(n);
    this.rateHz = new Float32Array(n);
    this.lastPreTick = new Int32Array(this.synapses);
    this.lastPostTick = new Int32Array(n);
    resetLastSpikeTicks(this.lastPreTick);
    this.lastPostTick.fill(-2147483648);
  }

  private buildInputProjection(): void {
    this.inTargetsP = new Int32Array(INPUT_BINS * IN_FANOUT);
    this.inTargetsM = new Int32Array(INPUT_BINS * IN_FANOUT);
    for (let b = 0; b < INPUT_BINS; b++) {
      for (let f = 0; f < IN_FANOUT; f++) {
        this.inTargetsP[b * IN_FANOUT + f] = this.rng() * this.nP | 0;
        this.inTargetsM[b * IN_FANOUT + f] = this.nP + (this.rng() * this.nM | 0);
      }
    }
  }

  private resetDynamics(): void {
    this.v.fill(0);
    this.iSyn.fill(0);
    this.refractory.fill(0);
    this.rateAccum.fill(0);
    this.ring = Array.from({ length: DELAY_TICKS }, () => []);
    this.ringPos = 0;
    this.pendingInput = [];
  }

  /* ------------------------------- Duet ---------------------------------- */

  /** Seed persona (soi-spec §3.1). Resets plasticity, never the graph. */
  seedPersona(vec: Float32Array): void {
    const derived = deriveSeed(vec, this.nP, this.nM, this.nE, this.cfg.seed);
    this.applySeedSync(vec, derived);
  }

  private applySeedSync(vec: Float32Array, derived: { biasPrimary: Float32Array; biasMeta: Float32Array; biasExpressive: Float32Array }): void {
    this.personaVec = vec;
    this.bias = new Float32Array(this.nTotal);
    this.bias.set(derived.biasPrimary, 0);
    this.bias.set(derived.biasMeta, this.nP);
    this.bias.set(derived.biasExpressive, this.nP + this.nM);
    this.calibrationCyclesLeft = 3;
  }

  /* ---------------------------- simulation ------------------------------- */

  private injectBins(bins: Iterable<number>, offset: Map<number, number>, metaOnly = false): void {
    for (const b of bins) {
      if (!metaOnly) {
        for (let f = 0; f < IN_FANOUT; f++) {
          const tp = this.inTargetsP[b * IN_FANOUT + f];
          offset.set(tp, (offset.get(tp) ?? 0) + 0.55);
        }
      }
      for (let f = 0; f < IN_FANOUT / 2; f++) {
        const tm = this.inTargetsM[b * IN_FANOUT + f];
        offset.set(tm, (offset.get(tm) ?? 0) + 0.25);
      }
    }
  }

  private stepTick(inputBins: number[], metaBins: number[] = []): void {
    const lifP = DEFAULT_LIF;
    // 1) decay + integrate with accumulated synaptic current
    integrate(this.v, this.iSyn, this.theta, this.refractory, lifP);
    // 2) fire
    const spiked: number[] = [];
    for (let i = 0; i < this.nTotal; i++) {
      if (this.v[i] >= this.theta[i] && this.refractory[i] === 0) {
        spiked.push(i);
        this.v[i] = DEFAULT_LIF.vReset;
        this.refractory[i] = DEFAULT_LIF.refractoryTicks;
        this.rateAccum[i]++;
      }
    }
    // 3) propagate spikes through CSR + event-driven STDP
    for (const i of spiked) {
      const start = this.indptr[i]; const end = this.indptr[i + 1];
      onPreSpike(i, this.tickCounter, this.indptr, this.indices, this.data, this.isInhibitory, this.lastPostTick, this.lastPreTick, DEFAULT_STDP);
      for (let e = start; e < end; e++) {
        this.iSyn[this.indices[e]] += this.data[e];
      }
      onPostSpike(i, this.tickCounter, this.lastPostTick, this.revIndptr, this.revIndices, this.revEdgeId, this.isInhibitory, this.data, this.lastPreTick, DEFAULT_STDP);
    }
    // 4) external input current for NEXT tick
    if (inputBins.length || metaBins.length) {
      const offset = new Map<number, number>();
      this.injectBins(inputBins, offset);
      if (metaBins.length) this.injectBins(metaBins, offset, true);
      for (const [neuron, amp] of offset) this.iSyn[neuron] += amp;
    }
    // small deterministic background current keeps E pool responsive
    for (let i = this.nP + this.nM; i < this.nTotal; i++) this.iSyn[i] += 0.02;
    // bias currents from persona seeding
    if (this.bias) for (let i = 0; i < this.nTotal; i++) this.iSyn[i] += this.bias[i];

    // clear consumed currents next tick happens naturally: iSyn accumulates then decays
    for (let i = 0; i < this.nTotal; i++) this.iSyn[i] *= 0.35;
    this.tickCounter++;
  }

  /**
   * One Duet cycle (FR-S3): prompt encodes into Primary; delayed copy feeds
   * Meta; Expressive integrates both. Returns decoded signals.
   * Runs in slice_ticks chunks, yielding to the event loop between slices.
   */
  async ingest(text: string, role: 'USER' | 'AGENT'): Promise<SoiSignals> {
    const trains = encodeText(text, INPUT_BINS, this.cfg.seed, this.cfg.cycle_ticks);
    // schedule input bins per tick of this cycle
    this.pendingInput = Array.from({ length: this.cfg.cycle_ticks }, () => [] as number[]);
    for (const t of trains) this.pendingInput[Math.min(t.tick, this.cfg.cycle_ticks - 1)].push(t.bin);

    // delayed copy: bins enter Meta at tick+DELAY_TICKS via the ring
    this.poolRates.fill(0);
    this.prevPoolRates.set(this.poolRates);
    let spikesThisCycle = 0;

    for (let sliceStart = 0; sliceStart < this.cfg.cycle_ticks; sliceStart += this.cfg.slice_ticks) {
      const sliceEnd = Math.min(sliceStart + this.cfg.slice_ticks, this.cfg.cycle_ticks);
      for (let t = sliceStart; t < sliceEnd; t++) {
        // release delayed ingress into Meta only (fixed 10-tick axonal delay)
        const delayed = this.ring[this.ringPos];
        const target = Math.min(t + DELAY_TICKS, this.cfg.cycle_ticks - 1);
        if (delayed.length && target !== t) {
          // merge into the future tick's input as meta-only delivery
          this.metaDelayed.push(...delayed);
        }
        this.ring[this.ringPos] = [...this.pendingInput[t]];
        this.ringPos = (this.ringPos + 1) % DELAY_TICKS;

        this.stepTick(this.pendingInput[t], this.metaDelayed);
        this.metaDelayed = [];
      }
      await new Promise(resolve => setImmediate(resolve)); // event-loop safe
    }

    // cycle end: rates, homeostasis, decode
    const dtSec = this.cfg.cycle_ticks * this.cfg.tick_ms / 1000;
    for (let i = 0; i < this.nTotal; i++) this.rateHz[i] = this.rateAccum[i] / dtSec;
    homeostasis(this.theta, this.rateHz);
    const sumPool = (from: number, to: number): number => {
      let s = 0; for (let i = from; i < to; i++) s += this.rateAccum[i];
      return s / (to - from);
    };
    this.prevPoolRates.set(this.poolRates);
    this.poolRates[0] = sumPool(0, this.nP);
    this.poolRates[1] = sumPool(this.nP, this.nP + this.nM);
    this.poolRates[2] = sumPool(this.nP + this.nM, this.nTotal);
    void spikesThisCycle;

    const signals = this.decode(role, text);
    this.rateAccum.fill(0);
    this.cycleCount++;
    return signals;
  }

  /* ------------------------------ decoder -------------------------------- */

  private calibrate(): boolean {
    if (this.calibrationCyclesLeft > 0) {
      // accumulate baseline statistics over calibration cycles
      this.baseline.mean[0] = this.poolRates[0]; this.baseline.std[0] = 1e-6;
      this.baseline.mean[1] = this.poolRates[1]; this.baseline.std[1] = 1e-6;
      this.baseline.mean[2] = this.poolRates[2]; this.baseline.std[2] = 1e-6;
      const ratio = (this.poolRates[1] + 1e-6) / (this.poolRates[0] + 1e-6);
      this.ratioMean = ratio; this.ratioStd = Math.max(ratio * 0.25, 1e-6);
      this.seededRatio = ratio;
      this.calibrationCyclesLeft--;
      return true;
    }
    return false;
  }

  private decode(role: 'USER' | 'AGENT', text: string): SoiSignals {
    if (this.calibrate()) {
      const neutral: SoiSignals = { confidence: 0.5, novelty: 0, bias_anomaly: false, salience: 0.1, persona_drift: 0 };
      this.lastSignals = neutral;
      return neutral;
    }
    const z = (x: number, i: number): number => (x - this.baseline.mean[i]) / this.baseline.std[i];
    const zP = z(this.poolRates[0], 0);
    const zM = z(this.poolRates[1], 1);
    const zE = z(this.poolRates[2], 2);

    // Novelty: ||r_M - r_M_baseline||
    const novelty = Math.abs(zM);
    // Confidence: r_E stability across last 2 cycles
    const stability = 1 - Math.min(1, Math.abs(zE - ((this.prevPoolRates[2] - this.baseline.mean[2]) / this.baseline.std[2])) / 4);
    const confidence = Math.max(0, Math.min(1, 0.5 + 0.5 * stability));
    // Bias anomaly: sustained r_M/r_P ratio deviation beyond k=2.5 sigma
    const ratio = (this.poolRates[1] + 1e-6) / (this.poolRates[0] + 1e-6);
    const ratioZ = (ratio - this.ratioMean) / this.ratioStd;
    this.ratioDeviations.push(ratioZ);
    if (this.ratioDeviations.length > 4) this.ratioDeviations.shift();
    const sustained = this.ratioDeviations.length >= 2 && this.ratioDeviations.every(d => Math.abs(d) > 2.5);
    // Salience: normalized total excitation
    const salience = Math.max(0, Math.min(1, (zP + zM + zE) / 9));
    // Persona drift: distance from seeded P/M ratio fingerprint
    const persona_drift = Math.abs(ratio - this.seededRatio) / (Math.abs(this.seededRatio) * 0.25 + 1e-6);

    const signals: SoiSignals = {
      confidence: Number(confidence.toFixed(4)),
      novelty: Number(novelty.toFixed(4)),
      bias_anomaly: sustained,
      salience: Number(salience.toFixed(4)),
      persona_drift: Number(persona_drift.toFixed(4))
    };

    // trace capture for consolidation
    const summary = `${role}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`;
    if (salience > 0.45 || signals.bias_anomaly) {
      this.traces.push({ ts: new Date().toISOString(), role, summary, salience: signals.salience, signals });
      const max = this.cfg.consolidate.max_traces;
      if (this.traces.length > max) this.traces.splice(0, this.traces.length - max);
    }
    void zP;
    this.lastSignals = signals;
    return signals;
  }

  /* ------------------------- persistence / API --------------------------- */

  getTraces(): SoiTrace[] { return [...this.traces]; }

  /** FR-S4 — fold salient traces out of the reservoir; caller applies them. */
  consolidate(): SoiTrace[] {
    const out = [...this.traces];
    this.traces = [];
    return out;
  }

  /** Capture the full reservoir state as plain typed arrays + scalars. */
  snapshot(): SoiSnapshot {
    return {
      cfg: {
        mode: this.cfg.mode,
        neurons: { ...this.cfg.neurons },
        connectivity: this.cfg.connectivity,
        tick_ms: this.cfg.tick_ms,
        cycle_ticks: this.cfg.cycle_ticks,
        slice_ticks: this.cfg.slice_ticks,
        stdp: { ...this.cfg.stdp },
        consolidate: { ...this.cfg.consolidate },
        seed: this.cfg.seed
      },
      twinId: this.twinId,
      tickCounter: this.tickCounter,
      cycleCount: this.cycleCount,
      calibrationCyclesLeft: this.calibrationCyclesLeft,
      baselineMean: Array.from(this.baseline.mean),
      baselineStd: Array.from(this.baseline.std),
      ratioMean: this.ratioMean,
      ratioStd: this.ratioStd,
      seededRatio: this.seededRatio,
      ratioDeviations: [...this.ratioDeviations],
      personaVec: this.personaVec ? Array.from(this.personaVec) : null,
      bias: this.bias ? Array.from(this.bias) : null,
      data: this.data,
      v: this.v,
      theta: this.theta,
      refractory: this.refractory,
      rateHz: this.rateHz,
      lastPreTick: this.lastPreTick,
      lastPostTick: this.lastPostTick,
      traces: [...this.traces]
    };
  }

  /** Rebuild a core from a snapshot; topology is regenerated deterministically. */
  static fromSnapshot(snap: SoiSnapshot): SoiCore {
    const core = new SoiCore({ ...snap.cfg }, snap.twinId);
    if (!SoiCore._topologyMatches(core, snap)) throw new Error('checkpoint/topology mismatch — refusing to restore');
    core.data.set(snap.data);
    core.v.set(snap.v);
    core.theta.set(snap.theta);
    core.refractory.set(snap.refractory);
    core.rateHz.set(snap.rateHz);
    core.lastPreTick.set(snap.lastPreTick);
    core.lastPostTick.set(snap.lastPostTick);
    core.tickCounter = snap.tickCounter;
    core.cycleCount = snap.cycleCount;
    core.calibrationCyclesLeft = snap.calibrationCyclesLeft;
    core.baseline.mean.set(snap.baselineMean);
    core.baseline.std.set(snap.baselineStd);
    core.ratioMean = snap.ratioMean;
    core.ratioStd = snap.ratioStd;
    core.seededRatio = snap.seededRatio;
    core.ratioDeviations = [...snap.ratioDeviations];
    core.personaVec = snap.personaVec ? Float32Array.from(snap.personaVec) : (undefined as never);
    core.bias = snap.bias ? Float32Array.from(snap.bias) : (undefined as never);
    core.traces = snap.traces.map(t => ({ ...t, signals: t.signals as SoiSignals }));
    return core;
  }

  private static _topologyMatches(core: SoiCore, snap: SoiSnapshot): boolean {
    return core.data.length === snap.data.length &&
      core.v.length === snap.v.length &&
      core.theta.length === snap.theta.length &&
      core.synapses === snap.data.length;
  }

  async checkpoint(dir?: string): Promise<void> {
    const buf = serializeSnapshot(this.snapshot());
    const target = dir ?? join(openworkerDir(), 'soi', 'checkpoints');
    await writeCheckpoint(buf, target);
  }

  static load(dir: string): SoiCore {
    return readLatestCheckpoint<SoiCore>(dir, buf => SoiCore.fromSnapshot(parseSnapshot(buf)));
  }

  stats(): SoiStats {
    const bytes =
      this.indptr.byteLength + this.indices.byteLength + this.data.byteLength +
      this.isInhibitory.byteLength + this.revIndptr.byteLength + this.revIndices.byteLength +
      this.revEdgeId.byteLength + this.v.byteLength + this.theta.byteLength + this.iSyn.byteLength +
      this.refractory.byteLength + this.rateAccum.byteLength + this.rateHz.byteLength +
      this.lastPreTick.byteLength + this.lastPostTick.byteLength +
      this.inTargetsP.byteLength + this.inTargetsM.byteLength;
    return {
      neurons: this.nTotal,
      synapses: this.synapses,
      bytes,
      cycles: this.cycleCount,
      traces: this.traces.length,
      lastSignals: this.lastSignals,
      twinId: this.twinId,
      mode: this.cfg.mode
    };
  }

  reset(): void {
    this.resetDynamics();
    this.traces = [];
    resetLastSpikeTicks(this.lastPreTick);
    this.lastPostTick.fill(-2147483648);
    this.tickCounter = 0;
    this.cycleCount = 0;
    this.calibrationCyclesLeft = 3;
    this.ratioDeviations = [];
  }
}

/** Deterministic seed derived from the twin id (cfg.seed=0 => derive). */
export function deriveTwinSeed(twinId: string): number {
  // FNV-1a over the id, folded into 31 bits
  let h = 2166136261 >>> 0;
  for (let i = 0; i < twinId.length; i++) {
    h ^= twinId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h & 0x7fffffff;
}
