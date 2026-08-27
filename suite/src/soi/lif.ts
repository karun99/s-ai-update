/**
 * SOI Leaky Integrate-and-Fire units (soi-spec §2, §4).
 *
 *   LIF:     v[i] += (v[i] * (1 - 1/tau)) + I_syn[i] - theta[i]
 *   spike:   if v[i] >= theta[i]: spike, v=v_reset, refractory=2
 *   homeo:   theta[i] += eta_h * (rate_i - 5Hz)          eta_h = 1e-4
 *
 * Pure functions over typed arrays; no allocation in hot paths.
 */

export interface LifParams {
  tau: number;        // membrane time constant in ticks (default 5 => 10ms @2ms ticks)
  vReset: number;     // reset potential (default 0)
  refractoryTicks: number; // 2
}

export const DEFAULT_LIF: LifParams = { tau: 5, vReset: 0, refractoryTicks: 2 };

/**
 * Advance one tick for `n` neurons. Mutates `v` in place.
 * Neurons in refractory hold v = vReset and ignore input current.
 * Returns nothing; firing detection happens in `fire()`.
 */
export function integrate(
  v: Float32Array,
  iSyn: Float32Array,
  theta: Float32Array,
  refractory: Int32Array,
  p: LifParams = DEFAULT_LIF
): void {
  const decay = 1 - 1 / p.tau;
  for (let i = 0; i < v.length; i++) {
    if (refractory[i] > 0) {
      refractory[i]--;
      v[i] = p.vReset;
      continue;
    }
    v[i] = v[i] * decay + iSyn[i] - theta[i];
  }
}

/**
 * Fire step: emit spike flags for neurons whose v >= theta, reset them,
 * start refractory. Returns the number of spikes this tick.
 */
export function fire(
  v: Float32Array,
  theta: Float32Array,
  refractory: Int32Array,
  p: LifParams = DEFAULT_LIF
): number {
  let spikes = 0;
  for (let i = 0; i < v.length; i++) {
    if (refractory[i] > 0) continue;
    if (v[i] >= theta[i]) {
      spikes++;
      v[i] = p.vReset;
      refractory[i] = p.refractoryTicks;
    }
  }
  return spikes;
}

/**
 * Homeostatic threshold drift toward the 5 Hz target (applied once per cycle).
 * rateHz[i] must be the neuron's firing rate over the finished cycle.
 */
export function homeostasis(theta: Float32Array, rateHz: Float32Array, etaH = 1e-4, targetHz = 5): void {
  for (let i = 0; i < theta.length; i++) {
    theta[i] += etaH * (rateHz[i] - targetHz);
  }
}
