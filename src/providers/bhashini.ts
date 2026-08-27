import { getProviderConfig } from '../config.js';
import type { ProviderConfig } from '../config.js';

interface BhashiniConfig extends ProviderConfig {
  userId?: string;
  pipelineId?: string;
}

interface BhashiniASRResult {
  transcript: string;
  confidence: number;
  sourceLanguage: string;
}

interface BhashiniTTSResult {
  audio: string;
  audioFormat: string;
}

interface BhashiniTranslateResult {
  sourceText: string;
  targetText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

const BHASHINI_BASE = 'https://meity-auth.ulcacontrib.org/ulca/apis/v1';

class BhashiniProvider {
  name = 'bhashini';
  config: BhashiniConfig;
  apiKey: string | undefined;
  userId: string;
  pipelineId: string;

  constructor(config: BhashiniConfig) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.userId = (config as any).userId || 's-ai-user';
    this.pipelineId = (config as any).pipelineId || '';
  }

  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey || '',
      'user-id': this.userId
    };
  }

  async searchPipelines(task: string, sourceLang?: string, targetLang?: string): Promise<any> {
    const body: Record<string, any> = {
      pipelineTasks: [{ taskType: task }],
      pipelineRequestConfig: { pipelineId: { pipelineId: this.pipelineId || '' } }
    };
    if (sourceLang) (body.pipelineTasks[0] as any).config = { language: sourceLang };
    if (targetLang && sourceLang) {
      (body.pipelineTasks[0] as any).config = { language: { sourceLanguage: sourceLang, targetLanguage: targetLang } };
    }
    const resp = await fetch(`${BHASHINI_BASE}/pipeline-search`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Bhashini pipeline search ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }

  async asr(audioBase64: string, audioFormat: string = 'wav', language: string = 'hi'): Promise<BhashiniASRResult> {
    const body = {
      pipelineTasks: [{
        taskType: 'asr',
        config: { language, audioFormat }
      }],
      inputData: { audio: [{ audioContent: audioBase64 }] },
      pipelineRequestConfig: { pipelineId: { pipelineId: this.pipelineId } }
    };
    const resp = await fetch(`${BHASHINI_BASE}/pipeline-compute`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Bhashini ASR ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const text = data?.pipelineResponse?.[0]?.output?.[0]?.source || '';
    const confidence = data?.pipelineResponse?.[0]?.output?.[0]?.confidence || 0;
    return { transcript: text, confidence, sourceLanguage: language };
  }

  async tts(text: string, language: string = 'hi', gender: string = 'female'): Promise<BhashiniTTSResult> {
    const body = {
      pipelineTasks: [{
        taskType: 'tts',
        config: { language, gender }
      }],
      inputData: { input: [{ source: text }] },
      pipelineRequestConfig: { pipelineId: { pipelineId: this.pipelineId } }
    };
    const resp = await fetch(`${BHASHINI_BASE}/pipeline-compute`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Bhashini TTS ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const audio = data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || '';
    const format = data?.pipelineResponse?.[0]?.audio?.[0]?.audioFormat || 'wav';
    return { audio, audioFormat: format };
  }

  async translate(text: string, sourceLanguage: string = 'en', targetLanguage: string = 'hi'): Promise<BhashiniTranslateResult> {
    const body = {
      pipelineTasks: [{
        taskType: 'translation',
        config: { language: { sourceLanguage, targetLanguage } }
      }],
      inputData: { input: [{ source: text }] },
      pipelineRequestConfig: { pipelineId: { pipelineId: this.pipelineId } }
    };
    const resp = await fetch(`${BHASHINI_BASE}/pipeline-compute`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Bhashini translate ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const targetText = data?.pipelineResponse?.[0]?.output?.[0]?.target || '';
    return { sourceText: text, targetText, sourceLanguage, targetLanguage };
  }

  async healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }> {
    if (!this.apiKey) return { ok: false, provider: 'bhashini', error: 'No API key configured. Set BHASHINI_API_KEY env var.' };
    try {
      const result = await this.searchPipelines('asr');
      return { ok: true, provider: 'bhashini' };
    } catch (e: any) {
      return { ok: false, provider: 'bhashini', error: e.message };
    }
  }
}

let _bhashiniInstance: BhashiniProvider | null = null;

function getBhashiniProvider(): BhashiniProvider {
  if (!_bhashiniInstance) {
    const config = getProviderConfig('bhashini') || {};
    _bhashiniInstance = new BhashiniProvider(config);
  }
  return _bhashiniInstance;
}

export { BhashiniProvider, getBhashiniProvider };
export type { BhashiniConfig, BhashiniASRResult, BhashiniTTSResult, BhashiniTranslateResult };
