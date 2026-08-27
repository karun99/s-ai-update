import { getProviderConfig, getActiveProvider } from '../config.js';
import type { ProviderConfig, ActiveProvider } from '../config.js';

interface CompleteResult {
  content: string;
  model?: string;
  usage?: Record<string, unknown>;
}

interface CompleteOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

class BaseProvider {
  name: string;
  config: ProviderConfig;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  defaultModel: string | undefined;

  constructor(name: string, config: ProviderConfig) {
    this.name = name;
    this.config = config;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    throw new Error(`${this.name}: stream() not implemented`);
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    return { ok: false, provider: this.name, error: 'not implemented' };
  }

  _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  _buildBody(messages: Array<{ role: string; content: string }>, options: CompleteOptions): Record<string, unknown> {
    return {
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: options.stream ?? false
    };
  }
}

class OpenAIProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('openai', config);
  }

  _headers(): Record<string, string> {
    return { ...super._headers(), 'Authorization': `Bearer ${this.apiKey}` };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenAI stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class AnthropicProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('anthropic', config);
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey!,
      'anthropic-version': '2023-06-01'
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    const body: Record<string, unknown> = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 2048,
      system,
      messages: chatMessages,
      temperature: options.temperature ?? 0.7
    };
    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.content?.map((b: any) => b.text).join('') || '';
    return { content, model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    const body: Record<string, unknown> = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 2048,
      system, messages: chatMessages,
      temperature: options.temperature ?? 0.7,
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Anthropic stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta') yield event.delta?.text || '';
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class GoogleProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('google', config);
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const model = options.model || this.defaultModel;
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const systemInstruction = messages.find(m => m.role === 'system');
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) (body as any).systemInstruction = { parts: [{ text: systemInstruction.content }] };
    (body as any).generationConfig = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 2048
    };
    const resp = await fetch(`${this.baseUrl}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Google ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    return { content, model, usage: data.usageMetadata };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const model = options.model || this.defaultModel;
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const systemInstruction = messages.find(m => m.role === 'system');
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) (body as any).systemInstruction = { parts: [{ text: systemInstruction.content }] };
    (body as any).generationConfig = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 2048
    };
    const resp = await fetch(`${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Google stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('');
            if (text) yield text;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class OpenRouterProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('openrouter', config);
  }

  _headers(): Record<string, string> {
    return {
      ...super._headers(),
      'Authorization': `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://s-ai.app',
      'X-Title': 'S-AI Swarm'
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenRouter stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class OllamaProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('ollama', config);
  }

  _headers(): Record<string, string> { return { 'Content-Type': 'application/json' }; }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = {
      model: options.model || this.defaultModel,
      messages,
      stream: false,
      options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 }
    };
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.message?.content || '', model: data.model };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = {
      model: options.model || this.defaultModel,
      messages, stream: true,
      options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 }
    };
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Ollama stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) yield data.message.content;
        } catch {}
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`);
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class NvidiaProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('nvidia', config);
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = {
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: false
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`NVIDIA ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = {
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`NVIDIA stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class AWSBedrockProvider extends BaseProvider {
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  sessionToken: string | undefined;

  constructor(config: ProviderConfig) {
    super('aws-bedrock', config);
    this.region = (config as any).region || 'us-east-1';
    this.accessKeyId = (config as any).accessKeyId;
    this.secretAccessKey = (config as any).secretAccessKey;
    this.sessionToken = (config as any).sessionToken;
  }

  _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  _getEndpoint(modelId: string): string {
    return `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/invoke`;
  }

  _getStreamEndpoint(modelId: string): string {
    return `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/invoke-with-response-stream`;
  }

  _buildBody(messages: Array<{ role: string; content: string }>, options: CompleteOptions): Record<string, unknown> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 2048,
      system,
      messages: chatMessages,
      temperature: options.temperature ?? 0.7
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const modelId = options.model || this.defaultModel || 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(this._getEndpoint(modelId), {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`AWS Bedrock ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.content?.map((b: any) => b.text).join('') || '';
    return { content, model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const modelId = options.model || this.defaultModel || 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(this._getStreamEndpoint(modelId), {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`AWS Bedrock stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta') yield event.delta?.text || '';
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class ClaudeAWSProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('claude-aws', config);
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey!,
      'anthropic-version': '2023-06-01'
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    const body: Record<string, unknown> = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 2048,
      system,
      messages: chatMessages,
      temperature: options.temperature ?? 0.7
    };
    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Claude AWS ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.content?.map((b: any) => b.text).join('') || '';
    return { content, model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    const body: Record<string, unknown> = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 2048,
      system, messages: chatMessages,
      temperature: options.temperature ?? 0.7,
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Claude AWS stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta') yield event.delta?.text || '';
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class VertexAIProvider extends BaseProvider {
  projectId: string;
  region: string;
  accessToken: string | undefined;

  constructor(config: ProviderConfig) {
    super('vertex-ai', config);
    this.projectId = (config as any).projectId || '';
    this.region = (config as any).region || 'us-east5';
    this.accessToken = (config as any).accessToken;
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`
    };
  }

  _getEndpoint(modelId: string): string {
    if (this.region === 'global') {
      return `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/publishers/anthropic/models/${modelId}:rawPredict`;
    } else if (this.region === 'us' || this.region === 'eu') {
      return `https://aiplatform.${this.region}.rep.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${modelId}:rawPredict`;
    }
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${modelId}:rawPredict`;
  }

  _getStreamEndpoint(modelId: string): string {
    if (this.region === 'global') {
      return `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/publishers/anthropic/models/${modelId}:streamRawPredict`;
    } else if (this.region === 'us' || this.region === 'eu') {
      return `https://aiplatform.${this.region}.rep.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${modelId}:streamRawPredict`;
    }
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${modelId}:streamRawPredict`;
  }

  _buildBody(messages: Array<{ role: string; content: string }>, options: CompleteOptions): Record<string, unknown> {
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    return {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: options.maxTokens ?? 2048,
      system,
      messages: chatMessages,
      temperature: options.temperature ?? 0.7
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const modelId = options.model || this.defaultModel || 'claude-sonnet-4-20250514';
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(this._getEndpoint(modelId), {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Vertex AI ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.content?.map((b: any) => b.text).join('') || '';
    return { content, model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const modelId = options.model || this.defaultModel || 'claude-sonnet-4-20250514';
    const body = this._buildBody(messages, { ...options });
    (body as any).stream = true;
    const resp = await fetch(this._getStreamEndpoint(modelId), {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Vertex AI stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta') yield event.delta?.text || '';
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class FoundryProvider extends BaseProvider {
  resource: string;
  declare apiKey: string | undefined;
  useEntraId: boolean;

  constructor(config: ProviderConfig) {
    super('foundry', config);
    this.resource = (config as any).resource || '';
    this.apiKey = config.apiKey;
    this.useEntraId = (config as any).useEntraId || false;
  }

  _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  _getBaseUrl(): string {
    return `https://${this.resource}.services.ai.azure.com/anthropic`;
  }

  _buildBody(messages: Array<{ role: string; content: string }>, options: CompleteOptions): Record<string, unknown> {
    return {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 2048,
      messages,
      temperature: options.temperature ?? 0.7
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this._getBaseUrl()}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Foundry ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const content = data.content?.map((b: any) => b.text).join('') || '';
    return { content, model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options });
    (body as any).stream = true;
    const resp = await fetch(`${this._getBaseUrl()}/v1/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Foundry stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content_block_delta') yield event.delta?.text || '';
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      await this.complete([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      return { ok: true, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class OpenAICompatibleProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('openai-compatible', config);
  }

  _headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenAI Compatible ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`OpenAI Compatible stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class KoboldCPPProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('koboldcpp', config);
    if (!this.baseUrl) this.baseUrl = 'http://localhost:5001';
  }

  _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const body = {
      prompt,
      max_context_length: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stop: ['\n\nuser:', '\n\nUser:']
    };
    const resp = await fetch(`${this.baseUrl}/api/v1/generate`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`KoboldCPP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.results?.[0]?.text || '', model: 'koboldcpp' };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const body = {
      prompt,
      max_context_length: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stop: ['\n\nuser:', '\n\nUser:'],
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/api/v1/generate`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`KoboldCPP stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) yield data.token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/model`);
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class OobaboogaProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('oobabooga', config);
    if (!this.baseUrl) this.baseUrl = 'http://localhost:5000';
  }

  _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = {
      mode: 'chat',
      messages,
      max_new_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      name1: 'User',
      name2: 'Assistant'
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Oobabooga ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.data || '', model: 'oobabooga' };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = {
      mode: 'chat',
      messages,
      max_new_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      name1: 'User',
      name2: 'Assistant',
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Oobabooga stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.data) yield data.data;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/model`);
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class MLCLLMProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('mlc-llm', config);
    if (!this.baseUrl) this.baseUrl = 'http://localhost:8080';
  }

  _headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = {
      model: options.model || this.defaultModel || 'vicuna-7b-v1.5',
      messages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stream: false
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`MLC LLM ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = {
      model: options.model || this.defaultModel || 'vicuna-7b-v1.5',
      messages,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`MLC LLM stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`);
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class PiProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('pi', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.inflection.ai';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Pi ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Pi stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class CohereProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('cohere', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.cohere.com';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const chatHistory = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, message: m.content }));
    const body = {
      model: options.model || this.defaultModel || 'command-r-plus',
      messages: chatHistory,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Cohere ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.message?.content?.[0]?.text || '', model: data.model, usage: data.meta?.tokens };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const chatHistory = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, message: m.content }));
    const body = {
      model: options.model || this.defaultModel || 'command-r-plus',
      messages: chatHistory,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      stream: true
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Cohere stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content-delta' && data.delta?.message?.content?.text) {
              yield data.delta.message.content.text;
            }
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class GrokProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('grok', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.x.ai';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Grok ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Grok stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class KimiProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('kimi', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.moonshot.cn';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Kimi ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Kimi stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class TogetherProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('together', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.together.xyz';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Together ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Together stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

class FireworksProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super('fireworks', config);
    if (!this.baseUrl) this.baseUrl = 'https://api.fireworks.ai';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async complete(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = this._buildBody(messages, { ...options, stream: false });
    const resp = await fetch(`${this.baseUrl}/inference/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Fireworks ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    return { content: data.choices?.[0]?.message?.content || '', model: data.model, usage: data.usage };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options: CompleteOptions = {}): AsyncGenerator<string, void, unknown> {
    const body = this._buildBody(messages, { ...options, stream: true });
    const resp = await fetch(`${this.baseUrl}/inference/v1/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Fireworks stream ${resp.status}`);
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const chunk = JSON.parse(line.slice(6));
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {}
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/inference/v1/models`, { headers: this._headers() });
      return { ok: resp.ok, provider: this.name };
    } catch (e: any) { return { ok: false, provider: this.name, error: e.message }; }
  }
}

const PROVIDERS: Record<string, new (config: ProviderConfig) => BaseProvider> = {
  openai: OpenAIProvider as any,
  anthropic: AnthropicProvider as any,
  google: GoogleProvider as any,
  openrouter: OpenRouterProvider as any,
  ollama: OllamaProvider as any,
  nvidia: NvidiaProvider as any,
  'aws-bedrock': AWSBedrockProvider as any,
  'claude-aws': ClaudeAWSProvider as any,
  'vertex-ai': VertexAIProvider as any,
  foundry: FoundryProvider as any,
  'openai-compatible': OpenAICompatibleProvider as any,
  'koboldcpp': KoboldCPPProvider as any,
  'oobabooga': OobaboogaProvider as any,
  'mlc-llm': MLCLLMProvider as any,
  'pi': PiProvider as any,
  'cohere': CohereProvider as any,
  'grok': GrokProvider as any,
  'kimi': KimiProvider as any,
  'together': TogetherProvider as any,
  'fireworks': FireworksProvider as any
};

function createProvider(name: string): BaseProvider {
  const config = getProviderConfig(name);
  if (!config) throw new Error(`Provider "${name}" not configured`);
  const ProviderClass = PROVIDERS[name];
  if (!ProviderClass) throw new Error(`Unknown provider: "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  return new (ProviderClass as any)(config);
}

function getActiveProviderInstance(): BaseProvider {
  const { name } = getActiveProvider();
  return createProvider(name);
}

function listProviders(): string[] {
  return [...Object.keys(PROVIDERS), 'bhashini'];
}

export { createProvider, getActiveProviderInstance, listProviders, BaseProvider, PROVIDERS };
export type { CompleteResult, CompleteOptions };
