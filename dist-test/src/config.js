import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const CONFIG_DIRS = [
    join(homedir(), '.config', 's-ai'),
    join(homedir(), '.s-ai'),
    join(process.cwd(), '.s-ai')
];
const CONFIG_FILES = ['config.json', 'config.jsonc'];
const DEFAULT_CONFIG_PATH = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'config.default.json');
let _config = null;
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge((result[key] || {}), source[key]);
        }
        else {
            result[key] = source[key];
        }
    }
    return result;
}
function loadConfig() {
    if (_config)
        return _config;
    let config = {};
    if (existsSync(DEFAULT_CONFIG_PATH)) {
        try {
            config = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
        }
        catch { }
    }
    for (const dir of CONFIG_DIRS) {
        for (const file of CONFIG_FILES) {
            const filePath = join(dir, file);
            if (existsSync(filePath)) {
                try {
                    const userConfig = JSON.parse(readFileSync(filePath, 'utf8'));
                    config = deepMerge(config, userConfig);
                }
                catch { }
            }
        }
    }
    const envConfig = {};
    const envProviders = {};
    if (process.env.SAI_PRIMARY_PROVIDER)
        envProviders.primary = process.env.SAI_PRIMARY_PROVIDER;
    if (process.env.OPENROUTER_API_KEY)
        envProviders.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
    if (process.env.OPENAI_API_KEY)
        envProviders.openai = { apiKey: process.env.OPENAI_API_KEY };
    if (process.env.ANTHROPIC_API_KEY)
        envProviders.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
    if (process.env.GOOGLE_API_KEY)
        envProviders.google = { apiKey: process.env.GOOGLE_API_KEY };
    if (process.env.OLLAMA_BASE_URL)
        envProviders.ollama = { baseUrl: process.env.OLLAMA_BASE_URL };
    if (process.env.NVIDIA_API_KEY)
        envProviders.nvidia = { apiKey: process.env.NVIDIA_API_KEY };
    if (process.env.AWS_BEDROCK_REGION)
        envProviders['aws-bedrock'] = { region: process.env.AWS_BEDROCK_REGION };
    if (process.env.AWS_ACCESS_KEY_ID)
        envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] || {}), accessKeyId: process.env.AWS_ACCESS_KEY_ID };
    if (process.env.AWS_SECRET_ACCESS_KEY)
        envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] || {}), secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY };
    if (process.env.AWS_SESSION_TOKEN)
        envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] || {}), sessionToken: process.env.AWS_SESSION_TOKEN };
    if (process.env.CLAUDE_AWS_API_KEY)
        envProviders['claude-aws'] = { apiKey: process.env.CLAUDE_AWS_API_KEY };
    if (process.env.VERTEX_AI_PROJECT_ID)
        envProviders['vertex-ai'] = { projectId: process.env.VERTEX_AI_PROJECT_ID };
    if (process.env.VERTEX_AI_REGION)
        envProviders['vertex-ai'] = { ...(envProviders['vertex-ai'] || {}), region: process.env.VERTEX_AI_REGION };
    if (process.env.VERTEX_AI_ACCESS_TOKEN)
        envProviders['vertex-ai'] = { ...(envProviders['vertex-ai'] || {}), accessToken: process.env.VERTEX_AI_ACCESS_TOKEN };
    if (process.env.FOUNDRY_RESOURCE)
        envProviders.foundry = { resource: process.env.FOUNDRY_RESOURCE };
    if (process.env.FOUNDRY_API_KEY)
        envProviders.foundry = { ...(envProviders.foundry || {}), apiKey: process.env.FOUNDRY_API_KEY };
    if (process.env.OPENAI_COMPATIBLE_BASE_URL)
        envProviders['openai-compatible'] = { baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL };
    if (process.env.OPENAI_COMPATIBLE_API_KEY)
        envProviders['openai-compatible'] = { ...(envProviders['openai-compatible'] || {}), apiKey: process.env.OPENAI_COMPATIBLE_API_KEY };
    if (process.env.BHASHINI_API_KEY)
        envProviders.bhashini = { apiKey: process.env.BHASHINI_API_KEY };
    if (process.env.BHASHINI_USER_ID)
        envProviders.bhashini = { ...(envProviders.bhashini || {}), userId: process.env.BHASHINI_USER_ID };
    if (process.env.BHASHINI_PIPELINE_ID)
        envProviders.bhashini = { ...(envProviders.bhashini || {}), pipelineId: process.env.BHASHINI_PIPELINE_ID };
    if (Object.keys(envProviders).length > 0)
        envConfig.providers = envProviders;
    if (Object.keys(envConfig).length > 0)
        config = deepMerge(config, envConfig);
    _config = config;
    return _config;
}
function getConfig() {
    return loadConfig();
}
function getConfigPath() {
    const primaryDir = CONFIG_DIRS[2];
    if (!existsSync(primaryDir))
        mkdirSync(primaryDir, { recursive: true });
    return join(primaryDir, 'config.json');
}
function saveConfig(config) {
    const configPath = getConfigPath();
    _config = config;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
}
function updateConfig(partial) {
    const config = deepMerge(loadConfig(), partial);
    return saveConfig(config);
}
function getProviderConfig(providerName) {
    const config = loadConfig();
    return config.providers?.[providerName] || null;
}
function getActiveProvider() {
    const config = loadConfig();
    const name = config.providers?.primary || 'openrouter';
    return { name, ...config.providers?.[name] || {} };
}
function getSwarmConfig() {
    return loadConfig().swarm || {};
}
function getCrawlConfig() {
    return loadConfig().crawl4ai || {};
}
function getMemoryConfig() {
    return loadConfig().memory || {};
}
function getMcpConfig() {
    return loadConfig().mcp || {};
}
function getNeuralConfig() {
    return loadConfig().neuralMap || { enabled: true, maxHistory: 50, autoProfile: false, persistAcrossSessions: true };
}
function getDataDir() {
    // Configurable data location. In serverless environments (Vercel/Render/etc.)
    // the home directory may be read-only or ephemeral, so SAI_DATA_DIR lets hosts
    // point state at a writable path (e.g. /tmp). Falls back to ~/.s-ai/data.
    const base = process.env.SAI_DATA_DIR ? join(process.env.SAI_DATA_DIR, '.s-ai', 'data') : join(homedir(), '.s-ai', 'data');
    const dir = base;
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function getGraphDir() {
    const dir = join(getDataDir(), 'graph');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function getCacheDir() {
    const dir = join(getDataDir(), 'cache');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function hashContent(content) {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
export { loadConfig, getConfig, getConfigPath, saveConfig, updateConfig, getProviderConfig, getActiveProvider, getSwarmConfig, getCrawlConfig, getMemoryConfig, getMcpConfig, getNeuralConfig, getDataDir, getGraphDir, getCacheDir, hashContent, deepMerge };
//# sourceMappingURL=config.js.map