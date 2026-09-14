/**
 * Cognitive Robotics Validation — organoid/MEA neural simulation, closed-loop
 * robotic control, and adversarial neural-security stress-testing.
 *
 * This module integrates the cognitive-robotics validation components:
 *   1. SpikeTensor  — organoid/MEA-style spike-train simulation
 *   2. ControlLoop  — closed-loop electrical feedback driving a virtual robot
 *   3. Adversarial  — adversarial signal injection + coherence/security metrics
 *
 * Used to validate S-AI's neural layers and satisfy the DARPA O-CIRCUIT
 * (bio-processing-unit) and organoid robotics research validation lines.
 */

import { createSpikeTensor, SpikeTensor, SpikeTensorConfig, SpikeStats } from './spike-tensor.js';
import { ControlLoop, MazeField, DEFAULT_MAZE, MazeResult } from './control-loop.js';
import { adversarialStressTest, CoherenceReport, ADVERSARIAL_SUITE, AdversarialTestCase } from './adversarial.js';

export { createSpikeTensor, ControlLoop, DEFAULT_MAZE, adversarialStressTest, ADVERSARIAL_SUITE };
export type { SpikeTensor, SpikeTensorConfig, SpikeStats, MazeField, MazeResult, CoherenceReport, AdversarialTestCase };

export interface CognitiveValidationConfig {
  electrodes?: number;
  timeBins?: number;
  baselineRate?: number;
  mazeSize?: number;
  maxControlSteps?: number;
}

export interface CognitiveValidationResult {
  spike: SpikeStats;
  robotics: MazeResult;
  adversarial: CoherenceReport;
  passed: boolean;
}

/**
 * Run the full cognitive-robotics validation harness.
 */
export function validateCognitiveRobotics(
  cfg: CognitiveValidationConfig = {},
): CognitiveValidationResult {
  const electrodes = cfg.electrodes ?? 12;
  const timeBins = cfg.timeBins ?? 64;
  const baselineRate = cfg.baselineRate ?? 0.3;
  const mazeSize = cfg.mazeSize ?? 5;
  const maxControlSteps = cfg.maxControlSteps ?? 40;

  const tensorConfig: SpikeTensorConfig = {
    electrodes,
    timeBins,
    baselineRate,
    refractoryBins: 2,
  };

  // 1. Spike simulation
  const spike = createSpikeTensor(tensorConfig).stats();

  // 2. Closed-loop robotic control (maze navigation via electrical feedback)
  const loop = new ControlLoop({
    inputElectrodes: electrodes,
    motorElectrodes: electrodes,
    timeBins,
    learningRate: 0.2,
    rewardDecay: 0.3,
    mazeSize,
  });
  const robotics = loop.run(DEFAULT_MAZE, [0, 0], maxControlSteps);

  // 3. Adversarial stress-test of neural security layers
  const adversarial = adversarialStressTest(tensorConfig, ADVERSARIAL_SUITE);

  const passed = robotics.solved && adversarial.passed;

  return { spike, robotics, adversarial, passed };
}

export default validateCognitiveRobotics;