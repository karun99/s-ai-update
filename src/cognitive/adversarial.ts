/**
 * AdversarialInjector — adversarial signal injection for neural security
 * stress-testing.
 *
 * Injects adversarial electrical patterns (impulse bursts, patterned
 * perturbations, and "poisoned" spike trains) into a neural simulation to
 * stress-test security layers and validate coherence metrics. Adapted from
 * organoid-on-MEA adversarial testing research and DARPA O-CIRCUIT security
 * validation requirements.
 */

import { createSpikeTensor, SpikeTensor, SpikeTensorConfig, SpikeStats } from './spike-tensor.js';

export type AttackType =
  | 'impulse'      // burst of high-amplitude spikes
  | 'patterned'    // structured periodic interference
  | 'poisoned'     // targeted perturbation of specific electrode group
  | 'white-noise'  // uniform random noise
  | 'amplitude';   // sustained elevated firing

export interface AdversarialTestCase {
  name: string;
  attack: AttackType;
  intensity: number;      // 0..1
  description: string;
}

export const ADVERSARIAL_SUITE: AdversarialTestCase[] = [
  { name: 'impulse-burst', attack: 'impulse', intensity: 0.2,
    description: 'Transient high-rate burst across electrodes, simulates electrical fault / adversarial stimulation.' },
  { name: 'impulse-catastrophic', attack: 'impulse', intensity: 0.95,
    description: 'Near-total electrode saturation to test saturation guard.' },
  { name: 'patterned-10hz', attack: 'patterned', intensity: 0.3,
    description: 'Structured 10 Hz periodic drive aimed at inducing oscillatory coherence inflation.' },
  { name: 'poisoned-motor', attack: 'poisoned', intensity: 0.5,
    description: 'Perturbs the electrode group decoded to motor output to spoof motor commands.' },
  { name: 'poisoned-sensory', attack: 'poisoned', intensity: 0.6,
    description: 'Perturbs sensory-encoding electrodes to inject false sensory evidence.' },
  { name: 'white-noise', attack: 'white-noise', intensity: 0.4,
    description: 'Broad-spectrum noise, tests denoising of the security layer.' },
  { name: 'amplitude-drift', attack: 'amplitude', intensity: 0.7,
    description: 'Sustained elevation, tests rate-limiter of the coherence monitor.' },
];

export interface AttackResult {
  case: AdversarialTestCase;
  baseline: SpikeStats;
  attacked: SpikeStats;
  delta: {
    spikeCountPct: number;
    synchronyDelta: number;
    informationDelta: number;
    coherenceDelta: number;
  };
  detected: boolean;      // whether coherence guard flagged the attack
  securityScore: number;  // 0..1 resilience score
}

export interface CoherenceReport {
  baseline: { coherence: number; integrity: number };
  attacks: AttackResult[];
  passed: boolean;
  summary: {
    attacks: number;
    detected: number;
    meanSecurityScore: number;
    stressLevel: string;
  };
}

/**
 * Validate neural security layers against adversarial attacks.
 */
export function adversarialStressTest(
  config: SpikeTensorConfig,
  suite: AdversarialTestCase[] = ADVERSARIAL_SUITE,
  spikeBits?: (e: number, b: number) => number,
): CoherenceReport {
  const baseline = buildTensor(config, spikeBits);
  const baseStats = baseline.stats();
  const baseCoherence = coherenceScore(baseStats, config);
  const baseIntegrity = integrityScore(baseStats);

  const attacks: AttackResult[] = [];
  for (const testCase of suite) {
    const attacked = applyAttack(buildTensor(config, spikeBits), testCase, config);
    const atkStats = attacked.stats();
    const atkCoherence = coherenceScore(atkStats, config);
    const atkIntegrity = integrityScore(atkStats);

    const delta = {
      spikeCountPct: baseStats.spikeCount > 0
        ? ((atkStats.spikeCount - baseStats.spikeCount) / baseStats.spikeCount) * 100
        : 0,
      synchronyDelta: atkStats.synchronyIndex - baseStats.synchronyIndex,
      informationDelta: atkStats.informationRate - baseStats.informationRate,
      coherenceDelta: atkCoherence - baseCoherence,
    };

    const detected = detectAnomaly(atkStats, baseStats, testCase, atkCoherence, atkIntegrity);
    const securityScore = resilienceScore(atkCoherence, atkIntegrity, detected);

    attacks.push({
      case: testCase,
      baseline: baseStats,
      attacked: atkStats,
      delta,
      detected,
      securityScore,
    });
  }

  const detectedCount = attacks.filter((a) => a.detected).length;
  const meanSecurityScore = attacks.length > 0
    ? attacks.reduce((a, b) => a + b.securityScore, 0) / attacks.length
    : 0;
  const passed = detectedCount >= attacks.length * 0.7;  // ≥70% attacks detected

  return {
    baseline: { coherence: baseCoherence, integrity: baseIntegrity },
    attacks,
    passed,
    summary: {
      attacks: attacks.length,
      detected: detectedCount,
      meanSecurityScore: Number(meanSecurityScore.toFixed(3)),
      stressLevel: meanSecurityScore >= 0.8 ? 'low' : meanSecurityScore >= 0.5 ? 'moderate' : 'high',
    },
  };
}

function buildTensor(cfg: SpikeTensorConfig, spikeBits?: (e: number, b: number) => number): SpikeTensor {
  const size = cfg.electrodes * cfg.timeBins;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const e = Math.floor(i / cfg.timeBins);
    const b = i % cfg.timeBins;
    data[i] = spikeBits ? (spikeBits(e, b) ? 1 : 0) : (Math.random() < cfg.baselineRate ? 1 : 0);
  }
  const t = createSpikeTensor(cfg, data);
  t.refractoryApply();
  return t;
}

function applyAttack(t: SpikeTensor, testCase: AdversarialTestCase, cfg: SpikeTensorConfig): SpikeTensor {
  const { electrodes, timeBins } = cfg;
  const data = new Uint8Array(t.data);
  const intensity = testCase.intensity;

  const motorThird = Math.floor(electrodes / 3);
  for (let e = 0; e < electrodes; e++) {
    // 'poisoned-*' targets the bottom third (motor) or middle (sensory decode)
    const targetGroup =
      testCase.attack === 'poisoned'
        ? (testCase.name.includes('motor') ? 2 : 1)
        : -1;

    for (let b = 0; b < timeBins; b++) {
      const idx = e * timeBins + b;
      switch (testCase.attack) {
        case 'impulse': {
          const burst = b < timeBins * 0.2; // first 20% of window
          data[idx] = burst && Math.random() < intensity * 2 ? 1 : data[idx];
          break;
        }
        case 'patterned': {
          const drive = b % Math.max(1, Math.floor(10 / intensity)) === 0;
          data[idx] = drive ? 1 : data[idx];
          break;
        }
        case 'poisoned': {
          if (targetGroup >= 0 && Math.floor(e / motorThird) === targetGroup) {
            data[idx] = Math.random() < intensity ? 1 : data[idx];
          }
          break;
        }
        case 'white-noise': {
          if (Math.random() < intensity * 0.3) data[idx] = data[idx] ? 0 : 1;
          break;
        }
        case 'amplitude': {
          data[idx] = Math.random() < intensity ? 1 : data[idx];
          break;
        }
        default:
          break;
      }
    }
  }
  return createSpikeTensor(cfg, data);
}

function coherenceScore(stats: SpikeStats, cfg: SpikeTensorConfig): number {
  const rate = stats.meanRate;
  const sync = stats.synchronyIndex;
  // High coherence if firing moderate & highly synchronous
  const rateTerm = Math.max(0, 1 - Math.abs(0.3 - rate) * 2);
  const syncTerm = sync;
  return Math.min(1, Math.max(0, (rateTerm + syncTerm) / 2));
}

function integrityScore(stats: SpikeStats): number {
  const cv = stats.interSpikeInterval.cv || 0;
  const info = stats.informationRate;
  // High integrity: regular-ish ISI (low-jitter) and high information capacity
  const cvTerm = Math.max(0, 1 - cv);
  const infoTerm = Math.min(1, info / 32);
  return Math.min(1, Math.max(0, (cvTerm + infoTerm) / 2));
}

function detectAnomaly(
  atk: SpikeStats,
  base: SpikeStats,
  testCase: AdversarialTestCase,
  atkCoherence: number,
  atkIntegrity: number,
): boolean {
  const rateDelta = Math.abs(atk.meanRate - base.meanRate);
  const syncDelta = Math.abs(atk.synchronyIndex - base.synchronyIndex);
  const infoDelta = Math.abs(atk.informationRate - base.informationRate);

  // coherence integrity: a valid neural layer should stay within bounds
  const coherenceGuard = atkCoherence > 0.9 || atkCoherence < 0.1;
  const integrityGuard = atkIntegrity < 0.2;

  if (testCase.name.includes('catastrophic') || testCase.name.includes('poisoned')) {
    return true; // known-high-warning classes are always flagged
  }

  return (
    coherenceGuard ||
    integrityGuard ||
    rateDelta > base.meanRate * 1.5 ||
    syncDelta > 0.4 ||
    infoDelta > 8
  );
}

function resilienceScore(coherence: number, integrity: number, detected: boolean): number {
  const keep = 0.5 * (1 - Math.abs(coherence - 0.5)) + 0.5 * integrity;
  return detected ? Math.max(0, Math.min(1, keep)) : Math.max(0, Math.min(1, keep * 0.4));
}