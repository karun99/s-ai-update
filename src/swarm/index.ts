import { EventEmitter } from 'node:events';
import { Agent } from './agent.js';
import { createProvider } from '../providers/index.js';
import { getSwarmConfig, getConfig } from '../config.js';
import { getNeuralMap } from '../neural/index.js';
import type { BaseProvider } from '../providers/index.js';

interface SwarmConfig {
  maxRounds?: number;
  consensusThreshold?: number;
  [key: string]: unknown;
}

interface RunOptions {
  maxRounds?: number;
  [key: string]: unknown;
}

interface RoundResult {
  round: number;
  plan: string;
  analysisA: string;
  analysisB: string;
  critique: string;
  consensus: number;
}

interface RunResult {
  content: string;
  rounds: number;
  elapsed: number;
  agents: Array<{ name: string; role: string; metrics: { tokens: number; cost: number; calls: number; errors: number } }>;
  consensus: number;
  executionPlan?: {
    actions: Array<{ tool: string; params: Record<string, unknown>; reason: string }>;
    rationale: string;
  };
}

interface SwarmStatus {
  status: string;
  agents: Array<{ id: string; name: string; role: string; status: string; metrics: { tokens: number; cost: number; calls: number; errors: number } }>;
  rounds: number;
  config: SwarmConfig;
}

interface StreamEvent {
  type: string;
  agent?: string;
  content?: string;
  token?: string;
  round?: number;
  score?: number;
  executionPlan?: { actions: Array<{ tool: string; params: Record<string, unknown>; reason: string }>; rationale: string };
}

class Swarm extends EventEmitter {
  config: SwarmConfig;
  agents: Map<string, Agent>;
  rounds: RoundResult[];
  status: string;
  private _personaContext: string;

  constructor(config: SwarmConfig = {}) {
    super();
    this.config = { ...getSwarmConfig(), ...config };
    this.agents = new Map();
    this.rounds = [];
    this.status = 'idle';
    this._personaContext = '';
    this._initDefaultAgents();
  }

  _initDefaultAgents(): void {
    const provider = this._createProvider();
    this.addAgent('orchestrator', 'Orchestrator', 'orchestrator', { provider, temperature: 0.3 });
    this.addAgent('researcher', 'Researcher', 'researcher', { provider, temperature: 0.5 });
    this.addAgent('analyst-a', 'Analyst A', 'analyst', { provider, temperature: 0.7 });
    this.addAgent('analyst-b', "Analyst B (Devil's Advocate)", 'analyst', { provider, temperature: 0.8 });
    this.addAgent('critic', 'Critic', 'critic', { provider, temperature: 0.6 });
    this.addAgent('synthesizer', 'Synthesizer', 'synthesizer', { provider, temperature: 0.4 });
    this.addAgent('action-planner', 'Action Planner', 'action-planner', { provider, temperature: 0.2 });
  }

  _createProvider(providerName?: string): BaseProvider {
    const name = providerName || (getConfig().providers?.primary as string) || 'openrouter';
    return createProvider(name);
  }

  setPersonaContext(personaContext: string): void {
    this._personaContext = personaContext;
    for (const agent of this.agents.values()) {
      agent.setPersonaContext(personaContext);
    }
  }

  getPersonaContext(): string {
    return this._personaContext;
  }

  addAgent(id: string, name: string, role: string, opts: { provider?: BaseProvider; temperature?: number; maxTokens?: number } = {}): Agent {
    const agent = new Agent(name, role, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens
    });
    agent.setProvider(opts.provider || this._createProvider());
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  async run(userMessage: string, options: RunOptions = {}): Promise<RunResult> {
    this.status = 'running';
    const startTime = Date.now();
    const maxRounds = options.maxRounds || (this.config.maxRounds as number) || 3;
    this.emit('start', { message: userMessage, agentCount: this.agents.size });

    const context = {
      message: userMessage,
      history: [] as RoundResult[],
      crawlResults: null as string | null,
      analyses: [] as any[],
      critiques: [] as any[],
      final: null as any
    };

    for (let round = 0; round < maxRounds; round++) {
      this.emit('round', { round: round + 1, maxRounds });
      const roundResult = await this._runRound(context, round);
      this.rounds.push(roundResult);
      context.history.push(roundResult);

      if (roundResult.consensus >= ((this.config.consensusThreshold as number) || 0.7)) {
        this.emit('consensus', { round: round + 1, score: roundResult.consensus });
        break;
      }
    }

    const synthesizer = this.agents.get('synthesizer')!;
    const synthesis = await synthesizer.think({
      instruction: 'Synthesize all analyses into a final, balanced response. Reduce bias by weighing all perspectives. If a user persona is loaded via neural mapping, adapt your communication style to match the user\'s preferred tone and formality.',
      message: userMessage,
      roundResults: this.rounds
    });
    context.final = synthesis;

    let executionPlan: RunResult['executionPlan'] = undefined;
    try {
      const planner = this.agents.get('action-planner')!;
      const planResult = await planner.think({
        instruction: `You are the Action Planner. Given the user's request and the swarm's analysis, propose concrete actions the system can take.

Available tools and their risk levels:
- readFile (low): Read a file. Params: { path }
- writeFile (medium): Write a file. Params: { path, content }
- listDir (low): List directory. Params: { path }
- searchFiles (low): Search files. Params: { path, pattern, maxResults }
- execShell (high): Execute shell command. Params: { command, cwd }
- httpRequest (medium): HTTP request. Params: { url, method, headers, body }
- sendEmail (high): Send email. Params: { to, subject, body }
- calendarEvent (medium): Create calendar event. Params: { title, start, end, description }
- notify (low): Send notification. Params: { title, message, urgency }
- crawlWeb (low): Crawl URLs. Params: { urls, query }
- searchArxiv (low): Search papers. Params: { query, maxResults }
- swarmQuery (low): Query swarm. Params: { question, maxRounds }
- graphStore (low): Store in graph. Params: { type, label, content }
- graphQuery (low): Query graph. Params: { query }
- webhook (medium): Send webhook. Params: { url, payload, method }

If the request requires actions, respond with a JSON code block:
\`\`\`json
{
  "actions": [
    { "tool": "toolName", "params": { ... }, "reason": "why this action" }
  ],
  "rationale": "overall plan rationale"
}
\`\`\`

If the request is purely analytical with no actions needed, respond with:
\`\`\`json
{ "actions": [], "rationale": "No actions needed — this is an analysis-only request." }
\`\`\``,
        message: userMessage,
        synthesis: synthesis.content,
        analyses: context.analyses,
        critiques: context.critiques
      });

      try {
        const jsonMatch = planResult.content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed.actions)) {
            executionPlan = { actions: parsed.actions, rationale: parsed.rationale || '' };
          }
        }
      } catch { /* action plan parsing is best-effort */ }
    } catch { /* action planner is optional */ }

    const elapsed = Date.now() - startTime;
    this.status = 'idle';
    this.emit('complete', { result: synthesis, rounds: this.rounds.length, elapsed });
    return {
      content: synthesis.content,
      rounds: this.rounds.length,
      elapsed,
      agents: [...this.agents.values()].map(a => ({ name: a.name, role: a.role, metrics: a.metrics })),
      consensus: this.rounds[this.rounds.length - 1]?.consensus || 0,
      executionPlan
    };
  }

  async *runStream(userMessage: string, options: RunOptions = {}): AsyncGenerator<StreamEvent, void, unknown> {
    this.status = 'running';
    this.emit('start', { message: userMessage, agentCount: this.agents.size });

    const context: {
      message: string;
      history: RoundResult[];
      analyses: any[];
      critiques: any[];
      crawlResults?: string;
    } = { message: userMessage, history: [], analyses: [], critiques: [] };
    const maxRounds = options.maxRounds || (this.config.maxRounds as number) || 3;

    for (let round = 0; round < maxRounds; round++) {
      this.emit('round', { round: round + 1, maxRounds });

      const orchestrator = this.agents.get('orchestrator')!;
      const plan = await orchestrator.think({
        instruction: 'Plan how to analyze this request. Which agents should analyze? What web content should be crawled?',
        message: userMessage,
        round
      });
      yield { type: 'plan', agent: 'orchestrator', content: plan.content };

      if (round === 0 && this._needsWebResearch(plan.content)) {
        const researcher = this.agents.get('researcher')!;
        const researchStream = researcher.thinkStream({
          instruction: 'Research this topic. Extract key facts, sources, and insights.',
          message: userMessage
        });
        let researchContent = '';
        for await (const token of researchStream) {
          researchContent += token;
          yield { type: 'research', agent: 'researcher', token };
        }
        context.crawlResults = researchContent;
      }

      const analystA = this.agents.get('analyst-a')!;
      const analysisA = await analystA.think({
        instruction: 'Provide your analysis. Focus on the positive aspects, opportunities, and supporting evidence.',
        message: userMessage,
        context: context.crawlResults
      });
      yield { type: 'analysis', agent: 'analyst-a', content: analysisA.content };
      context.analyses.push(analysisA);

      const analystB = this.agents.get('analyst-b')!;
      const analysisB = await analystB.think({
        instruction: 'Provide your analysis. Focus on risks, concerns, counter-arguments, and alternative perspectives.',
        message: userMessage,
        context: context.crawlResults
      });
      yield { type: 'analysis', agent: 'analyst-b', content: analysisB.content };
      context.analyses.push(analysisB);

      const critic = this.agents.get('critic')!;
      const critique = await critic.think({
        instruction: 'Evaluate both analyses for bias, logical errors, missing information, and accuracy.',
        analysisA: analysisA.content,
        analysisB: analysisB.content,
        message: userMessage
      });
      yield { type: 'critique', agent: 'critic', content: critique.content };
      context.critiques.push(critique);

      const consensus = this._calculateConsensus(analysisA.content, analysisB.content, critique.content);
      yield { type: 'consensus', round: round + 1, score: consensus };

      if (consensus >= ((this.config.consensusThreshold as number) || 0.7)) break;
    }

    const synthesizer = this.agents.get('synthesizer')!;
    const synthStream = synthesizer.thinkStream({
      instruction: 'Synthesize all perspectives into a final, balanced response. Acknowledge different viewpoints. Reduce bias. If a user persona is loaded via neural mapping, adapt your communication style to match the user\'s preferred tone and formality.',
      message: userMessage,
      analyses: context.analyses,
      critiques: context.critiques
    });
    let finalContent = '';
    for await (const token of synthStream) {
      finalContent += token;
      yield { type: 'synthesis', agent: 'synthesizer', token };
    }

    let executionPlan: StreamEvent['executionPlan'] = undefined;
    try {
      const planner = this.agents.get('action-planner')!;
      const planResult = await planner.think({
        instruction: `You are the Action Planner. Given the user's request and the swarm's analysis, propose concrete actions.

Available tools: readFile, writeFile, listDir, searchFiles, execShell, httpRequest, sendEmail, calendarEvent, notify, crawlWeb, searchArxiv, swarmQuery, graphStore, graphQuery, webhook.

If actions are needed, respond with a JSON code block:
\`\`\`json
{ "actions": [{ "tool": "name", "params": {}, "reason": "why" }], "rationale": "plan" }
\`\`\`
If no actions needed: { "actions": [], "rationale": "analysis only" }`,
        message: userMessage,
        synthesis: finalContent
      });

      try {
        const jsonMatch = planResult.content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed.actions)) {
            executionPlan = { actions: parsed.actions, rationale: parsed.rationale || '' };
          }
        }
      } catch { /* action plan parsing is best-effort */ }

      yield { type: 'action-plan', agent: 'action-planner', executionPlan };
    } catch { /* action planner is optional */ }

    this.status = 'idle';
    yield { type: 'complete', content: finalContent, executionPlan };
  }

  async _runRound(context: any, round: number): Promise<RoundResult> {
    const orchestrator = this.agents.get('orchestrator')!;
    const plan = await orchestrator.think({
      instruction: `Round ${round + 1}: Plan analysis strategy. Consider previous rounds if any.`,
      message: context.message,
      previousRounds: context.history.length
    });

    if (round === 0 && this._needsWebResearch(plan.content)) {
      const researcher = this.agents.get('researcher')!;
      const research = await researcher.think({
        instruction: 'Research this topic thoroughly. Extract key facts and insights.',
        message: context.message
      });
      context.crawlResults = research.content;
    }

    const analystA = this.agents.get('analyst-a')!;
    const analysisA = await analystA.think({
      instruction: 'Provide your analysis: opportunities, supporting evidence, positive aspects.',
      message: context.message,
      context: context.crawlResults
    });

    const analystB = this.agents.get('analyst-b')!;
    const analysisB = await analystB.think({
      instruction: 'Provide your analysis: risks, counter-arguments, concerns, alternative views.',
      message: context.message,
      context: context.crawlResults
    });

    const critic = this.agents.get('critic')!;
    const critique = await critic.think({
      instruction: 'Evaluate both analyses for bias, accuracy, logical errors.',
      analysisA: analysisA.content,
      analysisB: analysisB.content
    });

    const consensus = this._calculateConsensus(analysisA.content, analysisB.content, critique.content);
    return { round: round + 1, plan: plan.content, analysisA: analysisA.content, analysisB: analysisB.content, critique: critique.content, consensus };
  }

  _needsWebResearch(planContent: string): boolean {
    const keywords = ['research', 'search', 'web', 'current', 'latest', 'news', 'find', 'look up', 'source'];
    return keywords.some(k => planContent.toLowerCase().includes(k));
  }

  _calculateConsensus(a: string, b: string, critique: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w) && w.length > 3);
    const union = new Set([...wordsA, ...wordsB]);
    const similarity = union.size > 0 ? intersection.length / union.size : 0;
    const biasPenalty = (critique.match(/bias|biased|one-sided|lacks balance/gi) || []).length * 0.1;
    return Math.max(0, Math.min(1, similarity + 0.3 - biasPenalty));
  }

  getStatus(): SwarmStatus {
    return {
      status: this.status,
      agents: [...this.agents.entries()].map(([id, agent]) => ({
        id, name: agent.name, role: agent.role, status: agent.status, metrics: agent.metrics
      })),
      rounds: this.rounds.length,
      config: this.config
    };
  }

  reset(): void {
    for (const agent of this.agents.values()) agent.reset();
    this.rounds = [];
    this.status = 'idle';
  }
}

export { Swarm };
export type { SwarmConfig, RunOptions, RoundResult, RunResult, SwarmStatus, StreamEvent };
