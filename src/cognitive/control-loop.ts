/**
 * ControlLoop — closed-loop electrical feedback controller.
 *
 * Models an organoid-on-MEA driving a virtual robot through a maze or
 * performing an engineering task. Sensory input is encoded into stimulation
 * electrodes; the organoid's spike response is decoded into motor commands;
 * feedback from the environment (reward / obstacle detection) is folded back
 * into the stimulation pattern to implement closed-loop adaptation.
 *
 * This mirrors real organoid robotics (e.g., DishBrain-like maze navigation
 * via MEA closed-loop) and DARPA BPU edge-control workloads.
 */

import { createSpikeTensor, SpikeTensor, SpikeTensorConfig } from './spike-tensor.js';

export interface ControlLoopConfig {
  inputElectrodes: number;   // electrodes carrying sensory encoding
  motorElectrodes: number;   // electrodes decoded into motor commands
  timeBins: number;          // bins per control step
  learningRate: number;      // closed-loop feedback gain into stimulation
  rewardDecay: number;       // exponential reward memory decay
  mazeSize: number;          // labyrin compile test
}

export interface StepResult {
  step: number;
  sensor: number[];       // encoded sensory state
  stimulation: SpikeTensor;
  commands: number[];     // decoded motor commands (continuous)
  action: string;         // symbolic action taken
  reward: number;
  rewardMemory: number;   // smoothed reward estimate
  position: [number, number];
  distanceToGoal: number;
  coherence: number;      // spike-field coherence score this step
}

export interface MazeResult {
  steps: StepResult[];
  solved: boolean;
  totalReward: number;
  stepsUsed: number;
  route: string[];
}

export type MazeField = ('wall' | 'open' | 'goal')[][];

export const DEFAULT_MAZE: MazeField = [
  ['open', 'open', 'wall', 'open', 'goal'],
  ['wall', 'open', 'wall', 'open', 'wall'],
  ['open', 'open', 'open', 'open', 'wall'],
  ['open', 'wall', 'wall', 'wall', 'open'],
  ['open', 'open', 'open', 'open', 'open'],
];

export class ControlLoop {
  config: ControlLoopConfig;
  steps: StepResult[] = [];
  private rewardMem = 0;

  constructor(config: ControlLoopConfig) {
    this.config = config;
  }

  /**
   * Encode an agent position into a stimulation tensor.
   */
  private encodeSensory(position: [number, number], goal: [number, number]): number[] {
    const { inputElectrodes, mazeSize } = this.config;
    const sensor = new Array(inputElectrodes).fill(0);
    const dx = goal[0] - position[0];
    const dy = goal[1] - position[1];
    const dist = Math.hypot(dx, dy) || 1;
    // place-mosaic: electrodes at relative offsets light up based on distance
    for (let e = 0; e < inputElectrodes; e++) {
      const angle = (e / inputElectrodes) * Math.PI * 2;
      const nx = Math.cos(angle), ny = Math.sin(angle);
      const dot = (dx / dist) * nx + (dy / dist) * ny; // direction toward goal
      const proximity = 1 - Math.min(1, dist / mazeSize);
      sensor[e] = 0.5 + 0.5 * dot * proximity;
    }
    return sensor;
  }

  /**
   * Decode a spike tensor into motor commands (dx, dy, torque).
   */
  private decodeMotor(stimulation: SpikeTensor): number[] {
    const { motorElectrodes, timeBins } = this.config;
    const d = stimulation.data;
    let x = 0, y = 0, torque = 0;
    const perElectrode = Math.floor(motorElectrodes / 3) || 1;
    for (let e = 0; e < motorElectrodes; e++) {
      let fire = 0;
      for (let b = 0; b < timeBins; b++) if (d[e * timeBins + b]) fire++;
      const rate = timeBins > 0 ? fire / timeBins : 0;
      const group = Math.floor(e / perElectrode) % 3;
      if (group === 0) x += rate;
      else if (group === 1) y += rate;
      else torque += rate;
    }
    return [x / perElectrode, y / perElectrode, torque / perElectrode];
  }

  /**
   * Run one closed-loop control step.
   */
  step(position: [number, number], goal: [number, number], field: MazeField): StepResult {
    const { timeBins, learningRate, rewardDecay } = this.config;
    const sensor = this.encodeSensory(position, goal);
    const cfg: SpikeTensorConfig = {
      electrodes: sensor.length,
      timeBins,
      baselineRate: 0.5,
      refractoryBins: 2,
    };
    // stimulation strength ∝ learning rate + reward memory (closed-loop adaptation)
    const stimData = new Uint8Array(sensor.length * timeBins);
    for (let e = 0; e < sensor.length; e++) {
      const intensity = sensor[e] * (0.4 + learningRate) + this.rewardMem * rewardDecay * 0.6;
      const p = Math.min(1, Math.max(0, intensity));
      for (let b = 0; b < timeBins; b++) {
        stimData[e * timeBins + b] = Math.random() < p ? 1 : 0;
      }
    }
    const stimulation = createSpikeTensor(cfg, stimData);
    stimulation.refractoryApply();
    const commands = this.decodeMotor(stimulation);

    // Deterministic action from decoded commands
    const action = pickAction(commands);
    const next = applyAction(position, action, field);
    const reward = computeReward(position, goal, next, field);
    this.rewardMem = reward * 0.3 + this.rewardMem * (1 - 0.3);

    const stepResult: StepResult = {
      step: this.steps.length,
      sensor,
      stimulation,
      commands,
      action,
      reward,
      rewardMemory: this.rewardMem,
      position: next,
      distanceToGoal: Math.hypot(goal[0] - next[0], goal[1] - next[1]),
      coherence: spikeCoherence(stimulation),
    };
    this.steps.push(stepResult);
    return stepResult;
  }

  /**
   * Run the loop until solved or step budget exhausted.
   */
  run(field: MazeField = DEFAULT_MAZE, start: [number, number] = [0, 0], maxSteps = 50): MazeResult {
    const goal = findGoal(field);
    if (!goal) throw new Error('maze has no goal cell');
    let pos: [number, number] = start;
    const route: string[] = [];
    let totalReward = 0;
    let solved = false;
    this.steps = [];

    for (let stepN = 0; stepN < maxSteps; stepN++) {
      const r = this.step(pos, goal, field);
      route.push(r.action);
      totalReward += r.reward;
      pos = r.position;
      if (r.distanceToGoal < 0.01 || sameCell(pos, goal)) {
        solved = true;
        break;
      }
    }

    return {
      steps: this.steps,
      solved,
      totalReward,
      stepsUsed: this.steps.length,
      route,
    };
  }
}

function sameCell(a: [number, number], b: [number, number]): boolean {
  return Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]);
}

function findGoal(field: MazeField): [number, number] | null {
  for (let r = 0; r < field.length; r++) {
    for (let c = 0; c < field[r].length; c++) {
      if (field[r][c] === 'goal') return [r, c];
    }
  }
  return null;
}

function pickAction(commands: number[]): string {
  const [x, y] = commands;
  if (Math.abs(x) < 0.25 && Math.abs(y) < 0.25) return 'wait';
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'step_y+' : 'step_y-';
  return y > 0 ? 'step_x+' : 'step_x-';
}

function applyAction(position: [number, number], action: string, field: MazeField): [number, number] {
  let [r, c] = position;
  const h = field.length, w = field[0].length;
  switch (action) {
    case 'step_x+': c = Math.min(w - 1, c + 1); break;
    case 'step_x-': c = Math.max(0, c - 1); break;
    case 'step_y+': r = Math.min(h - 1, r + 1); break;
    case 'step_y-': r = Math.max(0, r - 1); break;
    default: break;
  }
  return field[r][c] !== 'wall' ? [r, c] : position;
}

function computeReward(
  from: [number, number],
  goal: [number, number],
  to: [number, number],
  field: MazeField,
): number {
  const d0 = Math.hypot(goal[0] - from[0], goal[1] - from[1]);
  const d1 = Math.hypot(goal[0] - to[0], goal[1] - to[1]);
  const improvement = d0 - d1;
  const goalCell = field[Math.round(to[0])]?.[Math.round(to[1])] === 'goal';
  return improvement + (goalCell ? 10 : 0);
}

function spikeCoherence(t: SpikeTensor): number {
  const stats = t.stats();
  // coherence = 1 for perfectly synchronous, decays with synchrony + rate balance
  const syncTerm = Math.min(1, stats.synchronyIndex * 2);
  const rateTerm = Math.max(0, 1 - Math.abs(0.2 - stats.meanRate) * 2);
  return Math.min(1, Math.max(0, (syncTerm + rateTerm) / 2));
}