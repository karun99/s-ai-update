import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createSpikeTensor,
  ControlLoop,
  DEFAULT_MAZE,
  adversarialStressTest,
  validateCognitiveRobotics,
  ADVERSARIAL_SUITE,
} from '../../src/cognitive/index.js';

describe('SpikeTensor (organoid/MEA)', () => {
  it('should produce a valid spike tensor with stats', () => {
    const t = createSpikeTensor({ electrodes: 8, timeBins: 64, baselineRate: 0.3, refractoryBins: 2 });
    const stats = t.stats();
    assert.strictEqual(stats.electrodes, 8);
    assert.strictEqual(stats.timeBins, 64);
    assert.ok(stats.spikeCount >= 0 && stats.spikeCount <= 8 * 64);
    assert.ok(stats.meanRate >= 0 && stats.meanRate <= 1);
  });

  it('should enforce refractory period', () => {
    const t = createSpikeTensor({ electrodes: 2, timeBins: 10, baselineRate: 1.0, refractoryBins: 3 });
    const before = t.stats().spikeCount;
    t.refractoryApply();
    const after = t.stats().spikeCount;
    assert.ok(after <= before);
    const d = t.data;
    for (let e = 0; e < 2; e++) {
      let last = -99;
      for (let b = 0; b < 10; b++) {
        if (d[e * 10 + b]) {
          assert.ok(b - last >= 3, `refractory violated at electrode ${e} bin ${b}`);
          last = b;
        }
      }
    }
  });

  it('should slice a time window', () => {
    const t = createSpikeTensor({ electrodes: 4, timeBins: 32, baselineRate: 0.5, refractoryBins: 1 });
    const s = t.slice(4, 12);
    assert.strictEqual(s.config.timeBins, 8);
    assert.strictEqual(s.config.electrodes, 4);
  });
});

describe('ControlLoop (closed-loop robotic control)', () => {
  it('should accept the default maze and enumerate positions', () => {
    const loop = new ControlLoop({
      inputElectrodes: 6, motorElectrodes: 6, timeBins: 32,
      learningRate: 0.2, rewardDecay: 0.3, mazeSize: 5,
    });
    const result = loop.run(DEFAULT_MAZE, [0, 0], 40);
    assert.ok(result.steps.length >= 1);
    assert.ok(Array.isArray(result.route));
    assert.ok(result.route.every((a) => ['wait', 'step_x+', 'step_x-', 'step_y+', 'step_y-'].includes(a)));
  });

  it('should return a step result with coherence', () => {
    const loop = new ControlLoop({
      inputElectrodes: 4, motorElectrodes: 4, timeBins: 16,
      learningRate: 0.2, rewardDecay: 0.3, mazeSize: 5,
    });
    const r = loop.step([0, 0], [4, 4], DEFAULT_MAZE);
    assert.ok(Array.isArray(r.sensor));
    assert.strictEqual(r.sensor.length, 4);
    assert.ok(r.coherence >= 0 && r.coherence <= 1);
  });
});

describe('adversarialStressTest (neural security layers)', () => {
  it('should run the full suite and produce a report', () => {
    const report = adversarialStressTest({
      electrodes: 8, timeBins: 48, baselineRate: 0.3, refractoryBins: 2,
    });
    assert.strictEqual(report.attacks.length, ADVERSARIAL_SUITE.length);
    assert.ok(report.baseline.coherence >= 0 && report.baseline.coherence <= 1);
    assert.strictEqual(typeof report.passed, 'boolean');
    for (const atk of report.attacks) {
      assert.strictEqual(typeof atk.detected, 'boolean');
      assert.ok(atk.securityScore >= 0 && atk.securityScore <= 1);
      assert.ok('coherenceDelta' in atk.delta);
    }
  });

  it('should flag known catastrophic classes as detected', () => {
    const report = adversarialStressTest({
      electrodes: 8, timeBins: 32, baselineRate: 0.3, refractoryBins: 2,
    });
    const catastrophic = report.attacks.find((a) => a.case.name === 'impulse-catastrophic');
    assert.ok(catastrophic);
    assert.strictEqual(catastrophic.detected, true);
  });
});

describe('validateCognitiveRobotics (integration harness)', () => {
  it('should produce a full validation result', () => {
    const result = validateCognitiveRobotics({ electrodes: 8, timeBins: 32 });
    assert.ok(result.spike);
    assert.ok(result.robotics);
    assert.ok(result.adversarial);
    assert.strictEqual(typeof result.passed, 'boolean');
  });
});