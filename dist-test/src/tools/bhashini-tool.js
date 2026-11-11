import { getBhashiniProvider } from '../providers/bhashini.js';
function getBhashiniTools() {
    return [
        {
            name: 'bhashini_translate',
            description: 'Translate text between Indian languages using Bhashini API',
            parameters: {
                text: { type: 'string', description: 'Text to translate' },
                sourceLanguage: { type: 'string', description: 'Source language code (e.g. en, hi, ta, te, bn, mr, gu)', default: 'en' },
                targetLanguage: { type: 'string', description: 'Target language code', default: 'hi' }
            },
            async execute({ text, sourceLanguage, targetLanguage }) {
                if (!text)
                    return { error: 'text is required' };
                try {
                    const bhashini = getBhashiniProvider();
                    const result = await bhashini.translate(text, sourceLanguage || 'en', targetLanguage || 'hi');
                    return {
                        translatedText: result.targetText,
                        sourceLanguage: result.sourceLanguage,
                        targetLanguage: result.targetLanguage
                    };
                }
                catch (e) {
                    return { error: `Bhashini translate failed: ${e.message}` };
                }
            }
        },
        {
            name: 'bhashini_tts',
            description: 'Convert text to speech in Indian languages using Bhashini API',
            parameters: {
                text: { type: 'string', description: 'Text to convert to speech' },
                language: { type: 'string', description: 'Language code', default: 'hi' },
                gender: { type: 'string', description: 'Voice gender (female/male)', default: 'female' }
            },
            async execute({ text, language, gender }) {
                if (!text)
                    return { error: 'text is required' };
                try {
                    const bhashini = getBhashiniProvider();
                    const result = await bhashini.tts(text, language || 'hi', gender || 'female');
                    return {
                        audioFormat: result.audioFormat,
                        audioLength: result.audio.length,
                        message: `Generated ${result.audioFormat} audio (${result.audio.length} chars base64)`
                    };
                }
                catch (e) {
                    return { error: `Bhashini TTS failed: ${e.message}` };
                }
            }
        },
        {
            name: 'bhashini_asr',
            description: 'Convert speech audio to text in Indian languages using Bhashini API',
            parameters: {
                audioBase64: { type: 'string', description: 'Base64-encoded audio data' },
                audioFormat: { type: 'string', description: 'Audio format (wav, mp3, etc)', default: 'wav' },
                language: { type: 'string', description: 'Language code', default: 'hi' }
            },
            async execute({ audioBase64, audioFormat, language }) {
                if (!audioBase64)
                    return { error: 'audioBase64 is required' };
                try {
                    const bhashini = getBhashiniProvider();
                    const result = await bhashini.asr(audioBase64, audioFormat || 'wav', language || 'hi');
                    return {
                        transcript: result.transcript,
                        confidence: result.confidence,
                        language: result.sourceLanguage
                    };
                }
                catch (e) {
                    return { error: `Bhashini ASR failed: ${e.message}` };
                }
            }
        }
    ];
}
export { getBhashiniTools };
//# sourceMappingURL=bhashini-tool.js.map