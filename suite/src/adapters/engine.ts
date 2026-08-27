/**
 * Engine adapter — the ONLY place that resolves and imports `@saikarun/s-ai`.
 *
 * Architecture rule (docs/architecture.md §3): the harness imports only public
 * engine exports; if an export is missing we add a thin adapter here rather
 * than modifying engine source.
 *
 * Resolution order:
 *   1. OPENWORKER_ENGINE_PATH env var (dir containing @saikarun/s-ai checkout)
 *   2. Monorepo sibling: walk up from this file to a repo root with dist/src/index.js
 *   3. Bare specifier `@saikarun/s-ai` (installed as a dependency)
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface EngineCompleteResult { content: string; model?: string; usage?: Record<string, unknown>; }
export interface EngineCompleteOptions { model?: string; temperature?: number; maxTokens?: number; stream?: boolean; }
export interface EngineMessage { role: string; content: string; }

export interface EngineProvider {
  name: string;
  complete(messages: EngineMessage[], options?: EngineCompleteOptions): Promise<EngineCompleteResult>;
  stream(messages: EngineMessage[], options?: EngineCompleteOptions): AsyncGenerator<string, void, unknown>;
  healthCheck(): Promise<{ ok: boolean; provider: string; error?: string }>;
}

export interface EngineSwarmAgentMetrics { tokens: number; cost: number; calls: number; errors: number; }
export interface EngineRunResult {
  content: string;
  rounds: number;
  elapsed: number;
  consensus: number;
  agents: Array<{ name: string; role: string; metrics: EngineSwarmAgentMetrics }>;
}
export type EngineStreamEvent = { type: string; agent?: string; content?: string; token?: string; round?: number; score?: number };
export interface EngineSwarm {
  run(userMessage: string, options?: Record<string, unknown>): Promise<EngineRunResult>;
  runStream(userMessage: string, options?: Record<string, unknown>): AsyncGenerator<EngineStreamEvent, void, unknown>;
  setPersonaContext(context: string): void;
  getStatus(): { status: string; agents: unknown[]; rounds: number };
  reset(): void;
}

export interface EngineGraph {
  addNode(type: string, label: string, data?: Record<string, unknown>): string;
  addEdge(sourceId: string, targetId: string, relation: string, weight?: number): void;
  query(question: string): Array<{ id: string; label: string; type: string; score: number; content?: string }>;
  getStats(): { nodes: number; edges: number; types: string[]; version: string };
}

export interface EngineNeuralMap {
  getProfile(): Record<string, unknown> | null;
  buildPersonaContext(): string;
  isEnabled(): boolean;
  setProfile?(data: Record<string, unknown>): void;
  clearProfile?(): void;
}

interface EngineModules {
  config: {
    getConfig(): Record<string, any>;
    updateConfig(partial: Record<string, unknown>): string;
  };
  providers: {
    createProvider(name: string): EngineProvider;
    listProviders(): string[];
  };
  swarm: { Swarm: new (config?: Record<string, unknown>) => EngineSwarm };
  graph: { KnowledgeGraph: new (graphDir?: string) => EngineGraph };
  neural: { getNeuralMap(config?: Record<string, unknown>): EngineNeuralMap };
  arxiv: {
    searchArxiv(query: string, start?: number, max?: number): Promise<{ papers: Array<Record<string, any>> }>;
    buildCitationGraph(papers: Array<Record<string, any>>): { nodes: number; edges: number };
  };
}

const _cache: { root: string | null; mods: Promise<EngineModules> | null } = { root: null, mods: null };

function looksLikeEngineRoot(dir: string): boolean {
  return existsSync(join(dir, 'dist', 'src', 'index.js'));
}

function findMonorepoEngineRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (looksLikeEngineRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Locate the engine package root without importing it (safe for off-mode purity). */
export function findEngineRoot(): string {
  if (_cache.root) return _cache.root;
  const candidates: string[] = [];
  if (process.env.OPENWORKER_ENGINE_PATH) candidates.push(resolve(process.env.OPENWORKER_ENGINE_PATH));
  candidates.push(findMonorepoEngineRoot(dirname(fileURLToPath(import.meta.url))) || '');
  for (const c of candidates) {
    if (c && looksLikeEngineRoot(c)) {
      _cache.root = c;
      return c;
    }
  }
  _cache.root = '';
  return '';
}

async function loadModules(): Promise<EngineModules> {
  const root = findEngineRoot();
  const spec = root ? pathToFileURL(join(root, 'dist', 'src')).href : '@saikarun/s-ai';
  try {
    const [config, providers, swarm, graph, neural, arxiv] = await Promise.all([
      import(`${spec}/config.js`),
      import(`${spec}/providers/index.js`),
      import(`${spec}/swarm/index.js`),
      import(`${spec}/memory/graph.js`),
      import(`${spec}/neural/index.js`),
      import(`${spec}/tools/arxiv.js`)
    ]);
    return { config, providers, swarm, graph, neural, arxiv } as EngineModules;
  } catch (err) {
    throw new Error(
      `S-AI engine not found. Looked at OPENWORKER_ENGINE_PATH=${process.env.OPENWORKER_ENGINE_PATH || '(unset)'}` +
      `${root ? `, monorepo root ${root}` : ', bare specifier @saikarun/s-ai'}. Original error: ${(err as Error).message}`
    );
  }
}

/** Lazily load engine modules once per process. Never called unless an engine feature is used. */
export async function loadEngine(): Promise<EngineModules> {
  if (!_cache.mods) _cache.mods = loadModules();
  return _cache.mods;
}
