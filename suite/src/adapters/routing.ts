/**
 * Unified provider:model routing (FR-C1, FR-C3).
 *
 * Conventions:
 *   - model ids look like `provider:model`  e.g. `openrouter:meta-llama/llama-3.1-8b-instruct:free`
 *   - client access is namespace-shaped:      ai.openai.chat.completions.create({ messages })
 *   - streaming on OpenAI-compatible providers yields token chunks
 *
 * All calls are delegated to the engine's public providers layer
 * (`createProvider`), never reimplemented.
 */
import { loadEngine } from './engine.js';

export interface ParsedModelId { provider: string; model?: string; }

export function parseModelId(id: string): ParsedModelId {
  const trimmed = (id || '').trim();
  if (!trimmed) throw new Error('empty provider:model id');
  const idx = trimmed.indexOf(':');
  if (idx === -1) return { provider: trimmed };
  const provider = trimmed.slice(0, idx);
  const model = trimmed.slice(idx + 1);
  if (!provider) throw new Error(`invalid provider:model id "${id}"`);
  return { provider, model: model || undefined };
}

export interface ChatCompletionParams {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletion {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
  usage?: Record<string, unknown>;
}

function makeChatNamespace(providerName: string, engine: Awaited<ReturnType<typeof loadEngine>>) {
  return {
    completions: {
      async create(params: ChatCompletionParams & { stream?: boolean }): Promise<ChatCompletion> {
        void engine;
        const provider = await resolveProvider(providerName);
        const result = await provider.complete(params.messages, {
          temperature: params.temperature,
          maxTokens: params.maxTokens
        });
        return {
          choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
          usage: result.usage
        };
      }
    }
  };
}

const _providerCache = new Map<string, import('./engine.js').EngineProvider>();

async function resolveProvider(name: string): Promise<import('./engine.js').EngineProvider> {
  const cached = _providerCache.get(name);
  if (cached) return cached;
  const engine = await loadEngine();
  const provider = engine.providers.createProvider(name);
  _providerCache.set(name, provider);
  return provider;
}

/**
 * ProviderClient — Proxy-based so `client.<provider>.chat.completions.create(...)`
 * provides a unified chat namespace across all configured providers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderClient = Record<string, { chat: { completions: { create(p: ChatCompletionParams & { stream?: boolean }): Promise<ChatCompletion> } } }>;

export class Router {
  /** Known providers from the engine registry + common aliases. */
  async listProviders(): Promise<string[]> {
    try {
      const engine = await loadEngine();
      return [...new Set([...engine.providers.listProviders(), 'openrouter', 'openai', 'anthropic', 'google', 'ollama'])];
    } catch {
      return ['openrouter', 'openai', 'anthropic', 'google', 'ollama'];
    }
  }

  parse(id: string): ParsedModelId { return parseModelId(id); }

  /** Single completion for a `provider:model` id. */
  async complete(modelId: string, params: ChatCompletionParams): Promise<ChatCompletion> {
    const { provider, model } = parseModelId(modelId);
    const p = await resolveProvider(provider);
    const result = await p.complete(params.messages, { model, temperature: params.temperature, maxTokens: params.maxTokens });
    return {
      choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
      usage: result.usage
    };
  }

  /** FR-C3 — streaming completion; yields token chunks. */
  async *stream(modelId: string, params: ChatCompletionParams): AsyncGenerator<string, void, unknown> {
    const { provider, model } = parseModelId(modelId);
    const p = await resolveProvider(provider);
    yield* p.stream(params.messages, { model, temperature: params.temperature, maxTokens: params.maxTokens });
  }

  /**
   * Provider namespace object: `await ai.get('openrouter')` then
   * `.chat.completions.create({messages})`.
   */
  async get(providerName: string): Promise<ProviderClient[string] & { chat: unknown }> {
    const engine = await loadEngine();
    // Touch the provider once so misconfiguration surfaces immediately.
    await resolveProvider(providerName);
    return { chat: makeChatNamespace(providerName, engine) } as never;
  }
}

let _router: Router | null = null;
export function getRouter(): Router {
  if (!_router) _router = new Router();
  return _router;
}
