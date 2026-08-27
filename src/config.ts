import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

interface SwarmConfig {
  maxAgents?: number;
  consensusThreshold?: number;
  maxRounds?: number;
  timeout?: number;
  biasReduction?: boolean;
}

interface CrawlConfig {
  enabled?: boolean;
  method?: string;
  maxPages?: number;
  respectRobotsTxt?: boolean;
  delayBetweenRequests?: number;
  contentMaxTokens?: number;
  cacheEnabled?: boolean;
  cacheTTL?: number;
}

interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  enabled?: boolean;
  transport?: string;
  servers?: McpServerConfig[];
}

interface MemoryConfig {
  backend?: string;
  maxNodes?: number;
  compressionThreshold?: number;
  autoArchive?: boolean;
}

interface NeuralMapConfig {
  enabled?: boolean;
  maxHistory?: number;
  autoProfile?: boolean;
  persistAcrossSessions?: boolean;
}

interface ServerConfig {
  port?: number;
  host?: string;
}

interface SAIConfig {
  version?: string;
  providers?: {
    primary?: string;
    fallback?: string;
    [key: string]: ProviderConfig | string | undefined;
  };
  swarm?: SwarmConfig;
  crawl4ai?: CrawlConfig;
  memory?: MemoryConfig;
  neuralMap?: NeuralMapConfig;
  mcp?: McpConfig;
  server?: ServerConfig;
  ui?: {
    theme?: string;
    accentColor?: string;
  };
  [key: string]: unknown;
}

interface ActiveProvider extends ProviderConfig {
  name: string;
}

const CONFIG_DIRS: string[] = [
  join(homedir(), '.config', 's-ai'),
  join(homedir(), '.s-ai'),
  join(process.cwd(), '.s-ai')
];

const CONFIG_FILES = ['config.json', 'config.jsonc'];
const DEFAULT_CONFIG_PATH = join(dirname(new URL(import.meta.url).pathname), '..', '..', 'config.default.json');

let _config: SAIConfig | null = null;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge((result[key] || {}) as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function loadConfig(): SAIConfig {
  if (_config) return _config;

  let config: SAIConfig = {};
  if (existsSync(DEFAULT_CONFIG_PATH)) {
    try { config = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf8')); } catch {}
  }

  for (const dir of CONFIG_DIRS) {
    for (const file of CONFIG_FILES) {
      const filePath = join(dir, file);
      if (existsSync(filePath)) {
        try {
          const userConfig = JSON.parse(readFileSync(filePath, 'utf8'));
          config = deepMerge(config, userConfig) as SAIConfig;
        } catch {}
      }
    }
  }

  const envConfig: Record<string, unknown> = {};
  const envProviders: Record<string, unknown> = {};
  if (process.env.SAI_PRIMARY_PROVIDER) envProviders.primary = process.env.SAI_PRIMARY_PROVIDER;
  if (process.env.OPENROUTER_API_KEY) envProviders.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
  if (process.env.OPENAI_API_KEY) envProviders.openai = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.ANTHROPIC_API_KEY) envProviders.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.GOOGLE_API_KEY) envProviders.google = { apiKey: process.env.GOOGLE_API_KEY };
  if (process.env.OLLAMA_BASE_URL) envProviders.ollama = { baseUrl: process.env.OLLAMA_BASE_URL };
  if (process.env.NVIDIA_API_KEY) envProviders.nvidia = { apiKey: process.env.NVIDIA_API_KEY };
  if (process.env.AWS_BEDROCK_REGION) envProviders['aws-bedrock'] = { region: process.env.AWS_BEDROCK_REGION };
  if (process.env.AWS_ACCESS_KEY_ID) envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] as Record<string, unknown> || {}), accessKeyId: process.env.AWS_ACCESS_KEY_ID };
  if (process.env.AWS_SECRET_ACCESS_KEY) envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] as Record<string, unknown> || {}), secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY };
  if (process.env.AWS_SESSION_TOKEN) envProviders['aws-bedrock'] = { ...(envProviders['aws-bedrock'] as Record<string, unknown> || {}), sessionToken: process.env.AWS_SESSION_TOKEN };
  if (process.env.CLAUDE_AWS_API_KEY) envProviders['claude-aws'] = { apiKey: process.env.CLAUDE_AWS_API_KEY };
  if (process.env.VERTEX_AI_PROJECT_ID) envProviders['vertex-ai'] = { projectId: process.env.VERTEX_AI_PROJECT_ID };
  if (process.env.VERTEX_AI_REGION) envProviders['vertex-ai'] = { ...(envProviders['vertex-ai'] as Record<string, unknown> || {}), region: process.env.VERTEX_AI_REGION };
  if (process.env.VERTEX_AI_ACCESS_TOKEN) envProviders['vertex-ai'] = { ...(envProviders['vertex-ai'] as Record<string, unknown> || {}), accessToken: process.env.VERTEX_AI_ACCESS_TOKEN };
  if (process.env.FOUNDRY_RESOURCE) envProviders.foundry = { resource: process.env.FOUNDRY_RESOURCE };
  if (process.env.FOUNDRY_API_KEY) envProviders.foundry = { ...(envProviders.foundry as Record<string, unknown> || {}), apiKey: process.env.FOUNDRY_API_KEY };
  if (process.env.OPENAI_COMPATIBLE_BASE_URL) envProviders['openai-compatible'] = { baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL };
  if (process.env.OPENAI_COMPATIBLE_API_KEY) envProviders['openai-compatible'] = { ...(envProviders['openai-compatible'] as Record<string, unknown> || {}), apiKey: process.env.OPENAI_COMPATIBLE_API_KEY };
  if (process.env.BHASHINI_API_KEY) envProviders.bhashini = { apiKey: process.env.BHASHINI_API_KEY };
  if (process.env.BHASHINI_USER_ID) envProviders.bhashini = { ...(envProviders.bhashini as Record<string, unknown> || {}), userId: process.env.BHASHINI_USER_ID };
  if (process.env.BHASHINI_PIPELINE_ID) envProviders.bhashini = { ...(envProviders.bhashini as Record<string, unknown> || {}), pipelineId: process.env.BHASHINI_PIPELINE_ID };
  if (Object.keys(envProviders).length > 0) envConfig.providers = envProviders;
  if (Object.keys(envConfig).length > 0) config = deepMerge(config as Record<string, unknown>, envConfig) as SAIConfig;

  _config = config;
  return _config;
}

function getConfig(): SAIConfig {
  return loadConfig();
}

function getConfigPath(): string {
  const primaryDir = CONFIG_DIRS[2];
  if (!existsSync(primaryDir)) mkdirSync(primaryDir, { recursive: true });
  return join(primaryDir, 'config.json');
}

function saveConfig(config: SAIConfig): string {
  const configPath = getConfigPath();
  _config = config;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function updateConfig(partial: Record<string, unknown>): string {
  const config = deepMerge(loadConfig() as Record<string, unknown>, partial);
  return saveConfig(config as SAIConfig);
}

function getProviderConfig(providerName: string): ProviderConfig | null {
  const config = loadConfig();
  return (config.providers?.[providerName] as ProviderConfig) || null;
}

function getActiveProvider(): ActiveProvider {
  const config = loadConfig();
  const name = (config.providers?.primary as string) || 'openrouter';
  return { name, ...(config.providers?.[name] as ProviderConfig) || {} };
}

function getSwarmConfig(): SwarmConfig {
  return loadConfig().swarm || {};
}

function getCrawlConfig(): CrawlConfig {
  return loadConfig().crawl4ai || {};
}

function getMemoryConfig(): MemoryConfig {
  return loadConfig().memory || {};
}

function getMcpConfig(): McpConfig {
  return loadConfig().mcp || {};
}

function getNeuralConfig(): NeuralMapConfig {
  return loadConfig().neuralMap || { enabled: true, maxHistory: 50, autoProfile: false, persistAcrossSessions: true };
}

function getDataDir(): string {
  const dir = join(homedir(), '.s-ai', 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getGraphDir(): string {
  const dir = join(getDataDir(), 'graph');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getCacheDir(): string {
  const dir = join(getDataDir(), 'cache');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export {
  loadConfig, getConfig, getConfigPath, saveConfig, updateConfig,
  getProviderConfig, getActiveProvider, getSwarmConfig, getCrawlConfig,
  getMemoryConfig, getMcpConfig, getNeuralConfig, getDataDir, getGraphDir, getCacheDir,
  hashContent, deepMerge
};
export type { SAIConfig, ProviderConfig, SwarmConfig, CrawlConfig, McpConfig, McpServerConfig, MemoryConfig, NeuralMapConfig, ServerConfig, ActiveProvider };
