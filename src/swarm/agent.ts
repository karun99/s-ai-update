import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BaseProvider } from '../providers/index.js';

interface AgentConfig {
  temperature?: number;
  maxTokens?: number;
  personaContext?: string;
  [key: string]: unknown;
}

interface AgentMetrics {
  tokens: number;
  cost: number;
  calls: number;
  errors: number;
}

interface ThinkResult {
  agent: string;
  role: string;
  content: string;
  elapsed: number;
  model?: string;
  error?: boolean;
}

interface Message {
  role: string;
  content: string;
}

class Agent {
  id: string;
  name: string;
  role: string;
  config: AgentConfig;
  provider: BaseProvider | null;
  status: string;
  history: Message[];
  metrics: AgentMetrics;

  constructor(name: string, role: string, config: AgentConfig = {}) {
    this.id = randomUUID().slice(0, 8);
    this.name = name;
    this.role = role;
    this.config = config;
    this.provider = null;
    this.status = 'idle';
    this.history = [];
    this.metrics = { tokens: 0, cost: 0, calls: 0, errors: 0 };
  }

  setProvider(provider: BaseProvider): this {
    this.provider = provider;
    return this;
  }

  setPersonaContext(personaContext: string): void {
    this.config.personaContext = personaContext;
  }

  async think(context: unknown, options?: { personaContext?: string }): Promise<ThinkResult> {
    this.status = 'thinking';
    const startTime = Date.now();
    try {
      const personaCtx = options?.personaContext || this.config.personaContext || '';
      const systemPrompt = this._systemPrompt(personaCtx);
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...this.history.slice(-10),
        { role: 'user', content: typeof context === 'string' ? context : JSON.stringify(context) }
      ];
      const result = await this.provider!.complete(messages, {
        temperature: this.config.temperature ?? 0.7,
        maxTokens: this.config.maxTokens ?? 1024
      });
      this.metrics.tokens += (result.usage as any)?.total_tokens || 0;
      this.metrics.calls++;
      this.history.push(
        { role: 'user', content: typeof context === 'string' ? context : JSON.stringify(context) },
        { role: 'assistant', content: result.content }
      );
      this.status = 'idle';
      return { agent: this.name, role: this.role, content: result.content, elapsed: Date.now() - startTime, model: result.model };
    } catch (err: any) {
      this.metrics.errors++;
      this.status = 'error';
      return { agent: this.name, role: this.role, content: `[ERROR] ${err.message}`, elapsed: Date.now() - startTime, error: true };
    }
  }

  async *thinkStream(context: unknown, options?: { personaContext?: string }): AsyncGenerator<string, void, unknown> {
    this.status = 'thinking';
    const personaCtx = options?.personaContext || this.config.personaContext || '';
    const systemPrompt = this._systemPrompt(personaCtx);
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...this.history.slice(-10),
      { role: 'user', content: typeof context === 'string' ? context : JSON.stringify(context) }
    ];
    const stream = this.provider!.stream(messages, {
      temperature: this.config.temperature ?? 0.7,
      maxTokens: this.config.maxTokens ?? 1024
    });
    let fullContent = '';
    for await (const token of stream) {
      fullContent += token;
      yield token;
    }
    this.history.push(
      { role: 'user', content: typeof context === 'string' ? context : JSON.stringify(context) },
      { role: 'assistant', content: fullContent }
    );
    this.metrics.calls++;
    this.status = 'idle';
  }

  _systemPrompt(personaContext?: string): string {
    let prompt = `You are ${this.name}, a ${this.role} agent in a multi-agent swarm system called S-AI.
Your job is to provide specialized analysis from your perspective. Be concise, accurate, and focused on your expertise.
Never fabricate information. If you don't know something, say so.`;
    if (personaContext) {
      prompt += `\n\nNEURAL MAPPING - USER PERSONA CONTEXT:\nThe user you are interacting with has the following profile. Adapt your communication style and responses to match their persona:\n\n${personaContext}`;
    }
    return prompt;
  }

  reset(): void {
    this.history = [];
    this.status = 'idle';
  }
}

export { Agent };
export type { AgentConfig, AgentMetrics, ThinkResult, Message };
