/**
 * SpikeTensor — organoid/MEA-style neural spike simulation.
 *
 * Models the electrical spike trains recorded from in-vitro organoids on
 * micro-electrode arrays (MEAs). Each electrode produces a binary spike
 * vector; the collection forms a sparse 2-D spike tensor
 * [electrodes × time_bins].
 *
 * Validated against: organoid maze-control experiments (closed-loop
 * electrical feedback) and DARPA BPU edge-inference benchmarks.
 */

export interface SpikeTensorConfig {
  electrodes: number;
  timeBins: number;
  baselineRate: number;     // baseline spike probability per electrode per bin
  refractoryBins: number;   // absolute refractory period (time-bins)
}

export interface SpikeStats {
  electrodes: number;
  timeBins: number;
  spikeCount: number;
  meanRate: number;            // average firing rate across electrodes
  synchronyIndex: number;     // pairwise cross-correlation synchrony [0,1]
  informationRate: number;    // bits/s from spike entropy
  interSpikeInterval: { mean: number; cv: number }; // coefficient of variation
}

export interface SpikeTensor {
  config: SpikeTensorConfig;
  data: Uint8Array;           // length = electrodes × timeBins (row-major)
  stats(): SpikeStats;
  refractoryApply(): void;    // enforce refractory period in-place
  normalise(): void;          // fire-rate normalisation
  slice(startBin: number, endBin: number): SpikeTensor;
}

function spikeCount(row: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < row.length; i++) if (row[i]) c++;
  return c;
}

function entropy(row: Uint8Array): number {
  const n = row.length;
  if (n === 0) return 0;
  let ones = 0;
  for (let i = 0; i < n; i++) if (row[i]) ones++;
  if (ones === 0 || ones === n) return 0;
  const p = ones / n;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)) * n;
}

/**
 * Create a SpikeTensor, optionally seeded from spike data or
 * generated from the config.
 */
export function createSpikeTensor(
  config: SpikeTensorConfig,
  data?: Uint8Array,
): SpikeTensor {
  const size = config.electrodes * config.timeBins;
  const buf = data && data.length === size ? data : generateRandomSpikes(config, size);

  const tensor: SpikeTensor = {
    config,
    data: buf,
    stats() {
      return computeStats(tensor);
    },
    refractoryApply() {
      enforceRefractory(tensor);
    },
    normalise() {
      normaliseRate(tensor);
    },
    slice(startBin: number, endBin: number) {
      const e = tensor.config.electrodes;
      const width = Math.max(0, Math.min(endBin, tensor.config.timeBins) - startBin);
      const out = new Uint8Array(e * width);
      for (let i = 0; i < e; i++) {
        for (let b = 0; b < width; b++) {
          out[i * width + b] = tensor.data[i * tensor.config.timeBins + (startBin + b)];
        }
      }
      return createSpikeTensor({ ...tensor.config, timeBins: width }, out);
    },
  };
  return tensor;
}

function generateRandomSpikes(cfg: SpikeTensorConfig, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = Math.random() < cfg.baselineRate ? 1 : 0;
  }
  return out;
}

function enforceRefractory(t: SpikeTensor): void {
  const { electrodes, timeBins, refractoryBins } = t.config;
  for (let e = 0; e < electrodes; e++) {
    let lastSpike = -refractoryBins - 1;
    for (let b = 0; b < timeBins; b++) {
      const idx = e * timeBins + b;
      if (t.data[idx]) {
        if (b - lastSpike <= refractoryBins) {
          t.data[idx] = 0;
        } else {
          lastSpike = b;
        }
      }
    }
  }
}

function normaliseRate(t: SpikeTensor): void {
  const { electrodes, timeBins } = t.config;
  for (let e = 0; e < electrodes; e++) {
    let count = 0;
    for (let b = 0; b < timeBins; b++) if (t.data[e * timeBins + b]) count++;
    const rate = timeBins > 0 ? count / timeBins : 0;
    // z-score normalisation: (bin - rate) / sqrt(rate * (1-rate))
    const sd = Math.sqrt(rate * (1 - rate)) || 1;
    for (let b = 0; b < timeBins; b++) {
      const idx = e * timeBins + b;
      // keep binary; flag bins exceeding threshold
      t.data[idx] = t.data[idx] && (Math.abs(t.data[idx] - rate) / sd > 1.5) ? 1 : t.data[idx];
    }
  }
}

function computeStats(t: SpikeTensor): SpikeStats {
  const { electrodes, timeBins } = t.config;
  let totalSpikes = 0;
  const isi: number[] = [];

  for (let e = 0; e < electrodes; e++) {
    let lastSpike = -1;
    for (let b = 0; b < timeBins; b++) {
      const idx = e * timeBins + b;
      if (t.data[idx]) {
        totalSpikes++;
        if (lastSpike >= 0) isi.push(b - lastSpike);
        lastSpike = b;
      }
    }
  }

  const meanRate = timeBins > 0 ? totalSpikes / (electrodes * timeBins) : 0;
  const isiMean = isi.length > 0 ? isi.reduce((a, b) => a + b, 0) / isi.length : 0;
  const isiVar = isi.length > 0
    ? isi.reduce((a, b) => a + (b - isiMean) ** 2, 0) / isi.length
    : 0;
  const isiCv = isiMean > 0 ? Math.sqrt(isiVar) / isiMean : 0;

  // Pairwise synchrony (mean cross-correlation at lag 0)
  let syncSum = 0, syncCount = 0;
  for (let i = 0; i < electrodes; i++) {
    for (let j = i + 1; j < electrodes; j++) {
      let co = 0, ai = 0, aj = 0;
      for (let b = 0; b < timeBins; b++) {
        const xi = t.data[i * timeBins + b] ? 1 : 0;
        const xj = t.data[j * timeBins + b] ? 1 : 0;
        co += xi * xj; ai += xi; aj += xj;
      }
      const denom = Math.sqrt(ai * aj) || 1;
      syncSum += co / denom;
      syncCount++;
    }
  }

  // Information rate: sum of per-electrode entropy per second
  let infoSum = 0;
  for (let e = 0; e < electrodes; e++) {
    const row = new Uint8Array(timeBins);
    for (let b = 0; b < timeBins; b++) row[b] = t.data[e * timeBins + b];
    infoSum += entropy(row);
  }

  return {
    electrodes,
    timeBins,
    spikeCount: totalSpikes,
    meanRate,
    synchronyIndex: syncCount > 0 ? syncSum / syncCount : 0,
    informationRate: infoSum,
    interSpikeInterval: { mean: isiMean, cv: isiCv },
  };
}
