/**
 * SOI Spike-Timing-Dependent Plasticity (soi-spec §4).
 *
 *   STDP:  dw =  A+ * exp(-dt/taup)   if pre before post    A+ = 0.010
 *          dw = -A- * exp(-dt/taum)   if post before pre   A- = 0.008
 *   clip w to [0, wmax=1.0]; inhibitory edges fixed
 *
 * Event-driven pair rule over a forward CSR (source -> targets) plus a reverse
 * CSR (target -> sources) so POST spikes can find their incoming edges.
 * Only spiked (touched) edges do work; no allocation in hot paths.
 */

export interface StdpParams {
  ap: number;    // 0.010
  am: number;    // 0.008
  taup: number;  // 10 ticks
  taum: number;  // 10 ticks
  wmax: number;  // 1.0
}

export const DEFAULT_STDP: StdpParams = { ap: 0.010, am: 0.008, taup: 10, taum: 10, wmax: 1.0 };

const NEVER = -2147483648;

export function resetLastSpikeTicks(lastPreTick: Int32Array): void {
  lastPreTick.fill(NEVER);
}

/**
 * On a presynaptic spike of `pre` at `tick`:
 *  - record lastPreTick for every outgoing edge
 *  - depress each outgoing excitatory edge whose target (post) fired shortly
 *    BEFORE now  =>  dw = -A- * exp(-dt/taum)
 * Returns number of weight updates applied.
 */
export function onPreSpike(
  pre: number,
  tick: number,
  indptr: Int32Array,
  indices: Uint32Array,
  data: Float32Array,
  isInhibitory: Uint8Array,
  lastPostTick: Int32Array,
  lastPreTick: Int32Array,
  p: StdpParams = DEFAULT_STDP
): number {
  let updates = 0;
  const start = indptr[pre];
  const end = indptr[pre + 1];
  for (let e = start; e < end; e++) {
    lastPreTick[e] = tick;
    if (isInhibitory[e]) continue;
    const post = indices[e];
    const lastPost = lastPostTick[post];
    if (lastPost === NEVER) continue;
    const dt = tick - lastPost;
    if (dt < 0 || dt > p.taum * 5) continue;
    const w = data[e] - p.am * Math.exp(-dt / p.taum);
    data[e] = w < 0 ? 0 : (w > p.wmax ? p.wmax : w);
    updates++;
  }
  return updates;
}

/**
 * On a postsynaptic spike of `post` at `tick`:
 *  - potentiate every incoming excitatory edge whose source fired shortly
 *    BEFORE now  =>  dw = +A+ * exp(-dt/taup)
 * Uses the reverse CSR; `revEdgeId[e]` maps back to the forward-data slot.
 * Returns number of weight updates applied.
 */
export function onPostSpike(
  post: number,
  tick: number,
  lastPostTick: Int32Array,
  revIndptr: Int32Array,
  revIndices: Uint32Array,
  revEdgeId: Int32Array,
  isInhibitory: Uint8Array,
  data: Float32Array,
  lastPreTick: Int32Array,
  p: StdpParams = DEFAULT_STDP
): number {
  lastPostTick[post] = tick;
  let updates = 0;
  const start = revIndptr[post];
  const end = revIndptr[post + 1];
  for (let e = start; e < end; e++) {
    const fwd = revEdgeId[e];
    if (isInhibitory[fwd]) continue;
    const lastPre = lastPreTick[fwd];
    if (lastPre === NEVER) continue;
    const dt = tick - lastPre;
    if (dt < 0 || dt > p.taup * 5) continue;
    const w = data[fwd] + p.ap * Math.exp(-dt / p.taup);
    data[fwd] = w > p.wmax ? p.wmax : (w < 0 ? 0 : w);
    updates++;
  }
  // Touch revIndices only to keep TS happy about unused params symmetry.
  void revIndices;
  return updates;
}
