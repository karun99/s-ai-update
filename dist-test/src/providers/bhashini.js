import { getProviderConfig } from '../config.js';
const BHASHINI_BASE = 'https://meity-auth.ulcacontrib.org/ulca/apis/v1';
class BhashiniProvider {
    name = 'bhashini';
    config;
    apiKey;
    userId;
    pipelineId;
    constructor(config) {
        this.config = config;
        this.apiKey = config.apiKey;
        this.userId = config.userId || 's-ai-user';
        this.pipelineId = config.pipelineId || '';
    }
    _headers() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey || '',
            'user-id': this.userId
        };
    }
    async searchPipelines(task, sourceLang, targetLang) {
        const body = {
            pipelineTasks: [{ taskType: task }],
            pipelineRequestConfig: { pipelineId: { pipelineId: this.pipelineId || '' } }
        };
        if (sourceLang)
            body.pipelineTasks[0].config = { language: sourceLang };
        if (targetLang && sourceLang) {
            body.pipelineTasks[0].config = { language: { sourceLanguage: sourceLang, targetLanguage: targetLang } };
        }
        const resp = await fetch(`${BHASHINI_BASE}/pipeline-search`, {
            method: 'POST', headers: this._headers(), body: JSON.stringify(body)
        });
        if (!resp.ok)
            throw new Error(`Bhashini pipeline search ${resp.status}: ${await resp.text()}`);
        return resp.json();
    }
    async asr(audioBase64, audioFormat = 'wav', language = 'hi') {
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
        if (!resp.ok)
            throw new Error(`Bhashini ASR ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        const text = data?.pipelineResponse?.[0]?.output?.[0]?.source || '';
        const confidence = data?.pipelineResponse?.[0]?.output?.[0]?.confidence || 0;
        return { transcript: text, confidence, sourceLanguage: language };
    }
    async tts(text, language = 'hi', gender = 'female') {
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
        if (!resp.ok)
            throw new Error(`Bhashini TTS ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        const audio = data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || '';
        const format = data?.pipelineResponse?.[0]?.audio?.[0]?.audioFormat || 'wav';
        return { audio, audioFormat: format };
    }
    async translate(text, sourceLanguage = 'en', targetLanguage = 'hi') {
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
        if (!resp.ok)
            throw new Error(`Bhashini translate ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        const targetText = data?.pipelineResponse?.[0]?.output?.[0]?.target || '';
        return { sourceText: text, targetText, sourceLanguage, targetLanguage };
    }
    async healthCheck() {
        if (!this.apiKey)
            return { ok: false, provider: 'bhashini', error: 'No API key configured. Set BHASHINI_API_KEY env var.' };
        try {
            const result = await this.searchPipelines('asr');
            return { ok: true, provider: 'bhashini' };
        }
        catch (e) {
            return { ok: false, provider: 'bhashini', error: e.message };
        }
    }
}
let _bhashiniInstance = null;
function getBhashiniProvider() {
    if (!_bhashiniInstance) {
        const config = getProviderConfig('bhashini') || {};
        _bhashiniInstance = new BhashiniProvider(config);
    }
    return _bhashiniInstance;
}
export { BhashiniProvider, getBhashiniProvider };
//# sourceMappingURL=bhashini.js.map