import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createAuthMiddleware, generateAuthToken } from './security/auth.js';
import { isPrivateUrl, safeFetch } from './security/ssrf.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export async function createServer(options = {}) {
    const { port = 3000, root = join(__dirname, '..'), listen = true } = options;
    const app = express();
    const publicDir = join(root, 'public');
    const { getDataDir, getGraphDir } = await import('./config.js');
    const dataDir = getDataDir();
    const graphDir = getGraphDir();
    if (!existsSync(dataDir))
        mkdirSync(dataDir, { recursive: true });
    if (!existsSync(graphDir))
        mkdirSync(graphDir, { recursive: true });
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('X-Frame-Options', 'DENY');
        res.header('X-XSS-Protection', '1; mode=block');
        res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        const allowed = ['http://localhost', 'http://127.0.0.1'];
        if (origin && allowed.some(a => origin.startsWith(a))) {
            res.header('Access-Control-Allow-Origin', origin);
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS')
            return res.sendStatus(200);
        next();
    });
    const rateLimits = new Map();
    app.use((req, res, next) => {
        if (req.path === '/health' || req.path === '/api/token')
            return next();
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = rateLimits.get(ip);
        if (entry && entry.resetAt > now) {
            if (entry.count >= 200) {
                return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: Math.ceil((entry.resetAt - now) / 1000) });
            }
            entry.count++;
        }
        else {
            rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
        }
        next();
    });
    const authMiddleware = createAuthMiddleware();
    app.use(authMiddleware);
    app.use(express.static(publicDir));
    let _swarm = null;
    async function getSwarm() {
        if (!_swarm) {
            const { Swarm } = await import('./swarm/index.js');
            _swarm = new Swarm();
        }
        return _swarm;
    }
    let _graph = null;
    async function getGraph() {
        if (!_graph) {
            const { getKnowledgeGraph } = await import('./memory/graph.js');
            _graph = getKnowledgeGraph();
        }
        return _graph;
    }
    app.get('/api/token', (_req, res) => {
        const token = generateAuthToken();
        res.json({
            token,
            usage: 'Add as Authorization: Bearer <token> header or ?token=<token> query parameter',
            note: 'Stored at ~/.s-ai/auth/server-token.json'
        });
    });
    app.post('/api/swarm/query', async (req, res) => {
        try {
            const { question, maxRounds = 2 } = req.body;
            if (!question)
                return res.status(400).json({ error: 'question is required' });
            const swarm = await getSwarm();
            const result = await swarm.run(question, { maxRounds });
            const graph = await getGraph();
            graph.addConversation(question, result.content);
            res.json(result);
        }
        catch (err) {
            console.error('Swarm query error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/swarm/status', async (req, res) => {
        try {
            const swarm = await getSwarm();
            res.json(swarm.getStatus());
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/swarm/reset', async (req, res) => {
        try {
            const swarm = await getSwarm();
            swarm.reset();
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/crawl', async (req, res) => {
        try {
            const { urls, query } = req.body;
            const urlList = Array.isArray(urls) ? urls : [];
            for (const u of urlList) {
                if (isPrivateUrl(u))
                    return res.status(400).json({ error: `Blocked private/internal URL: ${u}` });
            }
            const { getCrawlEngine } = await import('./tools/crawl.js');
            const engine = getCrawlEngine();
            const results = query ? await engine.search(query, { maxResults: 5 }) : await engine.crawl(urlList);
            res.json(results);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/graph', async (req, res) => {
        try {
            const graph = await getGraph();
            res.json(graph.graph);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/graph/query', async (req, res) => {
        try {
            const { query } = req.body;
            const graph = await getGraph();
            res.json(graph.query(query));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/graph/stats', async (req, res) => {
        try {
            const graph = await getGraph();
            res.json(graph.getStats());
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    let _neuralMap = null;
    async function getNeuralMap() {
        if (!_neuralMap) {
            const { getNeuralMap: getNM } = await import('./neural/index.js');
            _neuralMap = getNM();
        }
        return _neuralMap;
    }
    app.get('/api/persona', async (req, res) => {
        try {
            const neuralMap = await getNeuralMap();
            const profile = neuralMap.getProfile();
            if (!profile)
                return res.json({ active: false, profile: null });
            res.json({ active: true, profile });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/persona', async (req, res) => {
        try {
            const neuralMap = await getNeuralMap();
            const { name, bio, worldview, coreBeliefs, linguisticPatterns, cognitiveTraits, communicationStyle, contextNodes } = req.body;
            if (!name)
                return res.status(400).json({ error: 'name is required' });
            const profile = neuralMap.setProfile({ name, bio, worldview, coreBeliefs, linguisticPatterns, cognitiveTraits, communicationStyle, contextNodes });
            const swarm = await getSwarm();
            swarm.setPersonaContext(neuralMap.buildPersonaContext());
            res.json({ success: true, profile });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.delete('/api/persona', async (req, res) => {
        try {
            const neuralMap = await getNeuralMap();
            neuralMap.clearProfile();
            const swarm = await getSwarm();
            swarm.setPersonaContext('');
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/persona/context-node', async (req, res) => {
        try {
            const neuralMap = await getNeuralMap();
            const { type, title, content, mimeType } = req.body;
            if (!type || !content)
                return res.status(400).json({ error: 'type and content are required' });
            const node = neuralMap.addContextNode({ type, title: title || '', content, mimeType });
            const swarm = await getSwarm();
            swarm.setPersonaContext(neuralMap.buildPersonaContext());
            res.json({ success: true, node });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/persona/profiles', async (req, res) => {
        try {
            const neuralMap = await getNeuralMap();
            res.json({ profiles: neuralMap.listProfiles() });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/providers', async (req, res) => {
        try {
            const { listProviders } = await import('./providers/index.js');
            const { getActiveProvider } = await import('./config.js');
            const active = getActiveProvider();
            res.json({ providers: listProviders(), active: active.name });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/providers/test', async (req, res) => {
        try {
            const { getActiveProviderInstance } = await import('./providers/index.js');
            const provider = getActiveProviderInstance();
            res.json(await provider.healthCheck());
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/ai-engine/build', async (req, res) => {
        try {
            const { prompt, type = 'app' } = req.body;
            if (!prompt)
                return res.status(400).json({ error: 'prompt is required' });
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            let result;
            if (type === 'skill')
                result = await engine.buildSkill(prompt);
            else if (type === 'mcp')
                result = await engine.buildMcpServer(prompt);
            else if (type === 'swarm')
                result = await engine.buildSwarm(prompt);
            else
                result = await engine.buildApp(prompt);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/ai-engine/list', async (req, res) => {
        try {
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            const outputs = engine.listOutputs();
            res.json(outputs.map((o) => ({ id: o.id, type: o.id.split('_')[0], name: o.definition?.name || o.definition?.brand?.name, createdAt: o.createdAt })));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/ai-engine/:id', async (req, res) => {
        try {
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            const output = engine.getOutput(req.params.id);
            if (!output)
                return res.status(404).json({ error: 'not found' });
            res.json(output);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/mcp-builder/templates', async (req, res) => {
        try {
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            res.json(engine.getMcpTemplates().map((t) => ({
                id: t.id, name: t.name, description: t.description,
                category: t.category, tools: t.tools.length,
                memoryKB: Math.ceil(t.memoryBytes / 1024),
            })));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/mcp-builder/build', async (req, res) => {
        try {
            const { template, name, description, addTools, removeTools } = req.body;
            if (!template)
                return res.status(400).json({ error: 'template is required' });
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            const result = await engine.buildMcpFromTemplate(template, { name, description, addTools, removeTools });
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/skill-creator/templates', async (req, res) => {
        try {
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            res.json(engine.getSkillTemplates().map((t) => ({
                id: t.id, name: t.name, description: t.description,
                category: t.category, tools: t.tools.length,
                memoryKB: Math.ceil(t.memoryBytes / 1024),
            })));
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/skill-creator/build', async (req, res) => {
        try {
            const { template, name, description, addTools, removeTools } = req.body;
            if (!template)
                return res.status(400).json({ error: 'template is required' });
            const { AiEngine } = await import('../skills/ai-engine/engine.js');
            const engine = new AiEngine();
            const result = await engine.buildSkillFromTemplate(template, { name, description, addTools, removeTools });
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/research-mapper', (req, res) => {
        res.sendFile(join(publicDir, 'research-mapper.html'));
    });
    app.get('/api/research/search', async (req, res) => {
        try {
            const { q, max = '25' } = req.query;
            if (!q)
                return res.status(400).json({ error: 'query (q) is required' });
            const { searchArxiv, buildCitationGraph } = await import('./tools/arxiv.js');
            const result = await searchArxiv(q, 0, parseInt(max));
            const graph = buildCitationGraph(result.papers);
            const categories = [...new Set(result.papers.flatMap(p => p.categories.map((c) => c.split('.')[0])))];
            res.json({ papers: result.papers, graph, categories, total: result.totalResults });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/research/graph', async (req, res) => {
        try {
            const { ids } = req.query;
            if (!ids)
                return res.status(400).json({ error: 'ids (comma-separated arXiv IDs) is required' });
            const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
            const { fetchPaperDetailsBulk, buildCitationGraph } = await import('./tools/arxiv.js');
            const papers = await fetchPaperDetailsBulk(idList);
            const graph = buildCitationGraph(papers);
            res.json({ papers, graph });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/bhashini/translate', async (req, res) => {
        try {
            const { text, sourceLanguage = 'en', targetLanguage = 'hi' } = req.body;
            if (!text)
                return res.status(400).json({ error: 'text is required' });
            const { getBhashiniProvider } = await import('./providers/bhashini.js');
            const bhashini = getBhashiniProvider();
            const result = await bhashini.translate(text, sourceLanguage, targetLanguage);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/bhashini/tts', async (req, res) => {
        try {
            const { text, language = 'hi', gender = 'female' } = req.body;
            if (!text)
                return res.status(400).json({ error: 'text is required' });
            const { getBhashiniProvider } = await import('./providers/bhashini.js');
            const bhashini = getBhashiniProvider();
            const result = await bhashini.tts(text, language, gender);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/bhashini/asr', async (req, res) => {
        try {
            const { audioBase64, audioFormat = 'wav', language = 'hi' } = req.body;
            if (!audioBase64)
                return res.status(400).json({ error: 'audioBase64 is required' });
            const { getBhashiniProvider } = await import('./providers/bhashini.js');
            const bhashini = getBhashiniProvider();
            const result = await bhashini.asr(audioBase64, audioFormat, language);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/ai-engine', (req, res) => {
        res.sendFile(join(publicDir, 'ai-engine.html'));
    });
    app.get('/api/config', async (req, res) => {
        try {
            const { getConfig } = await import('./config.js');
            const config = getConfig();
            const redacted = JSON.parse(JSON.stringify(config));
            if (redacted.providers) {
                for (const [key, val] of Object.entries(redacted.providers)) {
                    if (val && typeof val === 'object') {
                        const p = val;
                        for (const sk of ['apiKey', 'secretAccessKey', 'sessionToken', 'accessToken']) {
                            if (p[sk])
                                p[sk] = '***';
                        }
                    }
                }
            }
            res.json(redacted);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/ai/call', async (req, res) => {
        try {
            const { provider, model, messages, system, contents, systemInstruction, generationConfig, temperature, max_tokens } = req.body;
            if (!provider || !model)
                return res.status(400).json({ error: 'provider and model are required' });
            const { getProviderConfig } = await import('./config.js');
            const pcfg = getProviderConfig(provider);
            if (!pcfg?.apiKey)
                return res.status(400).json({ error: `No API key configured for ${provider}. Set the environment variable.` });
            let result;
            if (provider === 'anthropic') {
                const resp = await safeFetch('https://api.anthropic.com/v1/messages', {
                    headers: { 'Content-Type': 'application/json', 'x-api-key': pcfg.apiKey, 'anthropic-version': '2023-06-01' },
                });
                result = await resp.json();
            }
            else if (provider === 'google') {
                const baseUrl = pcfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
                const resp = await safeFetch(`${baseUrl}/models/${model}:generateContent`, {
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': pcfg.apiKey },
                });
                result = await resp.json();
            }
            else {
                const baseUrl = pcfg.baseUrl || 'https://openrouter.ai/api/v1';
                const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pcfg.apiKey}` };
                if (provider === 'openrouter') {
                    headers['HTTP-Referer'] = req.headers.origin || 'http://localhost:3000';
                    headers['X-Title'] = 'S-AI';
                }
                const resp = await safeFetch(`${baseUrl}/chat/completions`, { headers });
                result = await resp.json();
            }
            res.json(result);
        }
        catch (err) {
            console.error('AI call error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/status', async (req, res) => {
        try {
            const graph = await getGraph();
            const stats = graph.getStats();
            res.json({ version: '6.1.0', uptime: process.uptime(), graph: stats, providers: { hasKey: !!(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY), bhashini: !!process.env.BHASHINI_API_KEY }, features: { researchMapper: true, bhashini: true, auth: true, ssrfHardened: true }, port });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/chat', async (req, res) => {
        try {
            const { message, provider, model } = req.body;
            if (!message)
                return res.status(400).json({ error: 'message is required' });
            const { getActiveProviderInstance } = await import('./providers/index.js');
            const { getActiveProvider, getProviderConfig } = await import('./config.js');
            const activeProvider = provider || getActiveProvider().name;
            const pcfg = getProviderConfig(activeProvider);
            if (!pcfg?.apiKey)
                return res.status(400).json({ error: `No API key configured for ${activeProvider}` });
            const resp = await safeFetch(`${pcfg.baseUrl || 'https://openrouter.ai/api/v1'}/chat/completions`, {
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pcfg.apiKey}` },
            });
            const result = await resp.json();
            const choices = result.choices;
            const graph = await getGraph();
            graph.addConversation(message, choices?.[0]?.message?.content || '');
            res.json(result);
        }
        catch (err) {
            console.error('Chat error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/history', async (req, res) => {
        try {
            const graph = await getGraph();
            const { limit = '50' } = req.query;
            const history = graph.getHistory(parseInt(limit));
            res.json({ history });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.post('/api/knowledge', async (req, res) => {
        try {
            const { type, label, content } = req.body;
            if (!type || !label)
                return res.status(400).json({ error: 'type and label are required' });
            const graph = await getGraph();
            const id = graph.addNode(type, label, { content: content || '' });
            res.json({ success: true, id });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/skills', async (req, res) => {
        try {
            const skillsDir = join(root, 'skills');
            if (!existsSync(skillsDir))
                return res.json({ skills: [] });
            const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            const skills = dirs.map(d => {
                const manifestPath = join(skillsDir, d.name, 'skill.json');
                if (existsSync(manifestPath)) {
                    try {
                        return JSON.parse(readFileSync(manifestPath, 'utf-8'));
                    }
                    catch {
                        return { name: d.name, version: 'unknown' };
                    }
                }
                return { name: d.name, version: 'unknown' };
            });
            res.json({ skills });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/'))
            res.sendFile(join(publicDir, 'index.html'));
    });
    if (!listen) {
        return app;
    }
    return new Promise((resolve) => {
        const server = app.listen(port, () => resolve(server));
    });
}
//# sourceMappingURL=server.js.map