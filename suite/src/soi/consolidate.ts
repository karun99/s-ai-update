/**
 * SOI consolidation (soi-spec §4.4 / FR-S4).
 *
 * "Sleep": fold salient traces into the engine knowledge graph and nudge
 * Neural Mapping tone weights, bounded to ±10%.
 */
import type { SoiTrace } from './core.js';

export interface GraphSink {
  addNode(type: string, label: string, data?: Record<string, unknown>): string;
  addEdge(sourceId: string, targetId: string, relation: string, weight?: number): void;
}

/** Extract up to `maxTraces` highest-salience traces as text summaries + scores. */
export function extractTraces(traces: SoiTrace[], maxTraces = 500): SoiTrace[] {
  return [...traces]
    .sort((a, b) => b.salience - a.salience)
    .slice(0, maxTraces);
}

/** Upsert traces into the knowledge graph; returns node ids created/reused. */
export function applyToGraph(sink: GraphSink, traces: SoiTrace[]): string[] {
  const ids: string[] = [];
  for (const trace of extractTraces(traces)) {
    const id = sink.addNode('soi_trace', trace.summary.slice(0, 80), {
      content: trace.summary,
      role: trace.role,
      salience: trace.salience,
      bias_anomaly: trace.signals?.bias_anomaly ?? false,
      timestamp: trace.ts
    });
    ids.push(id);
    if (trace.signals?.bias_anomaly) {
      const flagId = sink.addNode('soi_flag', `bias_anomaly:${trace.ts}`, { timestamp: trace.ts });
      sink.addEdge(id, flagId, 'flagged_by', trace.salience);
    }
  }
  return ids;
}

export interface ToneNudgeResult {
  applied: boolean;
  formalityDelta: number;
  verbosityDelta: number;
  technicalityDelta: number;
}

const MAX_NUDGE = 0.1;

/**
 * Nudge communication-style weights based on aggregate trace signals.
 * Bounded ±10% per consolidation pass (srs FR-S4). Pure function over a plain
 * profile object — caller persists via NeuralMap.setProfile.
 */
export function computeToneNudge(profile: Record<string, any>, traces: SoiTrace[]): ToneNudgeResult {
  const result: ToneNudgeResult = { applied: false, formalityDelta: 0, verbosityDelta: 0, technicalityDelta: 0 };
  if (!profile?.communicationStyle || traces.length === 0) return result;
  const avgSalience = traces.reduce((s, t) => s + t.salience, 0) / traces.length;
  const anomalies = traces.filter(t => t.signals?.bias_anomaly).length;
  // high-salience conversations => slightly more concise; anomaly-heavy => more formal
  result.verbosityDelta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -avgSalience * 0.08));
  result.formalityDelta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, (anomalies / traces.length) * 0.1));
  result.applied = true;
  void result.technicalityDelta;
  return result;
}

export function applyToneNudge(profile: Record<string, any>, traces: SoiTrace[]): Record<string, any> {
  const nudge = computeToneNudge(profile, traces);
  if (!nudge.applied) return profile;
  const cs = { ...profile.communicationStyle };
  cs.formality = clamp01(cs.formality + nudge.formalityDelta);
  cs.verbosity = clamp01(cs.verbosity + nudge.verbosityDelta);
  return { ...profile, communicationStyle: cs };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
