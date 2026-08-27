/**
 * Reach v2 registry (FR-R1, FR-R3) — Agent-Reach pattern.
 *
 * Each channel has an ORDERED list of backends; the first healthy backend
 * wins; failures mark a backend unhealthy for a TTL and failover continues
 * automatically. No reimplementation of upstream tools — thin capability
 * routing only. Channels v1: web, youtube, github, rss, arxiv, crawl.
 */
import { execFileSync } from 'node:child_process';
import { getReachCacheDir } from '../config.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export type ChannelName = 'web' | 'youtube' | 'github' | 'rss' | 'arxiv' | 'crawl';

export interface ProbeResult {
  ok: boolean;
  detail?: string;
  /** human-readable fix instruction shown by `reach doctor` */
  prescription?: string;
}

export interface ReadTarget {
  url?: string;
  query?: string;
}

export interface Backend {
  id: string;
  label: string;
  tier: 0 | 1 | 2;
  probe(): Promise<ProbeResult>;
  read(target: ReadTarget): Promise<string>;
  canHandle?(target: ReadTarget): boolean;
}

export interface FailoverLogEntry {
  ts: number;
  channel: ChannelName;
  backend: string;
  event: 'failover' | 'success' | 'exhausted' | 'unhealthy-marked';
  error?: string;
}

export interface RegistryOptions {
  unhealthyTtlMs?: number;
  cacheTtlMs?: number;
  cacheDir?: string;
  logLimit?: number;
}

const DEFAULT_TTL = 60_000;

export class ReachRegistry {
  private channels: Map<ChannelName, Backend[]>;
  private unhealthyUntil: Map<string, number> = new Map();
  private failoverLog: FailoverLogEntry[] = [];
  private opts: Required<Pick<RegistryOptions, 'unhealthyTtlMs' | 'cacheTtlMs'>> & { cacheDir: string; logLimit: number };

  constructor(channels?: Partial<Record<ChannelName, Backend[]>>, options: RegistryOptions = {}) {
    this.opts = {
      unhealthyTtlMs: options.unhealthyTtlMs ?? DEFAULT_TTL,
      cacheTtlMs: options.cacheTtlMs ?? DEFAULT_TTL,
      cacheDir: options.cacheDir ?? getReachCacheDir(),
      logLimit: options.logLimit ?? 200
    };
    this.channels = new Map(Object.entries(buildDefaultChannels()) as Array<[ChannelName, Backend[]]>);
    if (channels) {
      for (const [name, backends] of Object.entries(channels)) {
        if (backends && backends.length) this.channels.set(name as ChannelName, backends);
      }
    }
  }

  setBackends(channel: ChannelName, backends: Backend[]): void {
    this.channels.set(channel, backends);
  }

  getBackends(channel: ChannelName): Backend[] {
    return this.channels.get(channel) ?? [];
  }

  private _log(entry: FailoverLogEntry): void {
    this.failoverLog.push(entry);
    if (this.failoverLog.length > this.opts.logLimit) this.failoverLog.shift();
  }

  getFailoverLog(): FailoverLogEntry[] {
    return [...this.failoverLog];
  }

  isUnhealthy(backendId: string): boolean {
    const until = this.unhealthyUntil.get(backendId);
    return until !== undefined && until > Date.now();
  }

  markHealthy(backendId: string): void { this.unhealthyUntil.delete(backendId); }
  markUnhealthy(backendId: string, ttlMs = this.opts.unhealthyTtlMs): void {
    this.unhealthyUntil.set(backendId, Date.now() + ttlMs);
    this._log({ ts: Date.now(), channel: 'web', backend: backendId, event: 'unhealthy-marked' });
  }

  /* ------------------------------ caching ------------------------------ */

  private _cacheKey(channel: ChannelName, target: ReadTarget): string {
    return `${channel}:${createHash('sha1').update(JSON.stringify(target)).digest('hex').slice(0, 20)}.txt`;
  }

  private _cacheGet(key: string): string | null {
    const file = join(this.opts.cacheDir, key);
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { ts: number; body: string };
      if (Date.now() - raw.ts > this.opts.cacheTtlMs) return null;
      return raw.body;
    } catch { return null; }
  }

  private _cachePut(key: string, body: string): void {
    try {
      writeFileSync(join(this.opts.cacheDir, key), JSON.stringify({ ts: Date.now(), body }));
    } catch { /* cache is best-effort */ }
  }

  /**
   * FR-R1 — ordered failover read. Skips unhealthy backends (TTL), tries each
   * remaining in order, returns the first success. Throws with per-backend
   * errors when all fail ("no silent degradation").
   */
  async read(channel: ChannelName, target: ReadTarget, useCache = true): Promise<string> {
    const cacheKey = this._cacheKey(channel, target);
    if (useCache) {
      const hit = this._cacheGet(cacheKey);
      if (hit !== null) return hit;
    }
    const backends = this.getBackends(channel);
    const errors: string[] = [];
    for (const backend of backends) {
      if (backend.canHandle && !backend.canHandle(target)) continue;
      if (this.isUnhealthy(`${channel}/${backend.id}`)) continue;
      try {
        const body = await backend.read(target);
        this.markHealthy(`${channel}/${backend.id}`);
        this._log({ ts: Date.now(), channel, backend: backend.id, event: 'success' });
        if (useCache) this._cachePut(cacheKey, body);
        return body;
      } catch (err) {
        errors.push(`${backend.id}: ${(err as Error).message}`);
        this.markUnhealthy(`${channel}/${backend.id}`);
        this._log({ ts: Date.now(), channel, backend: backend.id, event: 'failover', error: (err as Error).message });
      }
    }
    this._log({ ts: Date.now(), channel, backend: '-', event: 'exhausted' });
    throw new Error(`all backends failed for channel "${channel}": ${errors.join('; ')}`);
  }
}

/* ------------------------------ HTTP helpers ------------------------------ */

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- default backends ----------------------------- */

function jinaReaderBackend(): Backend {
  return {
    id: 'jina-reader',
    label: 'Jina Reader',
    tier: 0,
    async probe() {
      try {
        const res = await fetchWithTimeout('https://r.jina.ai/https://example.com', { headers: { Accept: 'text/plain' }, timeoutMs: 8000 });
        return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}`, prescription: 'Jina Reader unreachable — check network/proxy; fallback direct-fetch will be used' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message, prescription: 'Jina Reader unreachable — check network/proxy; fallback direct-fetch will be used' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers: { 'User-Agent': 'OpenWorker-Reach/2.0', Accept: 'text/plain' } });
      if (!res.ok) throw new Error(`Jina Reader HTTP ${res.status}`);
      return res.text();
    },
    canHandle: t => Boolean(t.url)
  };
}

function directFetchBackend(): Backend {
  return {
    id: 'direct-fetch',
    label: 'Plain fetch',
    tier: 1,
    async probe() {
      try {
        const res = await fetchWithTimeout('https://example.com', { timeoutMs: 6000 });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}`, prescription: 'No outbound HTTP — configure a proxy (HTTPS_PROXY)' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message, prescription: 'No outbound HTTP — configure a proxy (HTTPS_PROXY)' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 OpenWorker-Reach/2.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Minimal HTML -> text so downstream agents see readable content.
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    canHandle: t => Boolean(t.url)
  };
}

function ytdlpBackend(): Backend {
  return {
    id: 'yt-dlp',
    label: 'yt-dlp',
    tier: 0,
    async probe() {
      try {
        const out = execFileSync('yt-dlp', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
        return { ok: true, detail: out };
      } catch {
        return { ok: false, prescription: 'Install: pip install yt-dlp' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const out = execFileSync('yt-dlp', ['--skip-download', '--dump-json', url], { encoding: 'utf8', timeout: 60_000 });
      const meta = JSON.parse(out.split('\n')[0]) as Record<string, any>;
      const subs = meta.subtitles?.en?.[0]?.data || meta.automatic_captions?.en?.[0]?.data || '';
      return `${meta.title || ''}\n\n${subs}`.trim() || 'No transcript available';
    },
    canHandle: t => Boolean(t.url && (t.url.includes('youtube.com') || t.url.includes('youtu.be')))
  };
}

function githubCliBackend(): Backend {
  return {
    id: 'gh-cli',
    label: 'gh CLI',
    tier: 0,
    async probe() {
      try {
        execFileSync('gh', ['--version'], { encoding: 'utf8', timeout: 10_000 });
        return { ok: true, detail: process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'auth token present' : 'run gh auth login for private repos' };
      } catch {
        return { ok: false, prescription: 'Install gh: https://cli.github.com/ then gh auth login' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
      if (!match) throw new Error('not a GitHub repo URL');
      return execFileSync('gh', ['repo', 'view', `${match[1]}/${match[2]}`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    },
    canHandle: t => Boolean(t.url && t.url.includes('github.com'))
  };
}

function githubApiBackend(): Backend {
  return {
    id: 'rest-api',
    label: 'GitHub REST API',
    tier: 1,
    async probe() {
      try {
        const res = await fetchWithTimeout('https://api.github.com/rate_limit', { timeoutMs: 8000 });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}`, prescription: 'GitHub API unreachable — check network' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message, prescription: 'GitHub API unreachable — check network' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
      if (!match) throw new Error('not a GitHub repo URL');
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenWorker-Reach/2.0' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const [readmeRes, metaRes] = await Promise.all([
        fetchWithTimeout(`https://api.github.com/repos/${match[1]}/${match[2]}/readme`, { headers }),
        fetchWithTimeout(`https://api.github.com/repos/${match[1]}/${match[2]}`, { headers })
      ]);
      if (!readmeRes.ok) throw new Error(`GitHub API HTTP ${readmeRes.status}`);
      const readme = (await readmeRes.json()) as { content?: string };
      const meta = metaRes.ok ? await metaRes.json() as Record<string, any> : {};
      const text = Buffer.from(readme.content || '', 'base64').toString('utf8');
      return `${meta.full_name || ''} ★${meta.stargazers_count ?? '?'}\n${meta.description || ''}\n\n${text}`;
    },
    canHandle: t => Boolean(t.url && t.url.includes('github.com'))
  };
}

function rssNativeBackend(): Backend {
  return {
    id: 'native-xml',
    label: 'fetch + XML parse',
    tier: 0,
    async probe() {
      try {
        const res = await fetchWithTimeout('https://hnrss.org/frontpage?count=1', { timeoutMs: 8000 });
        return { ok: res.ok, prescription: 'RSS probe failed — check network' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message, prescription: 'RSS probe failed — check network' };
      }
    },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = [...xml.matchAll(/<(item|entry)[\s\S]*?<\/\1>/g)].slice(0, 25).map(m => m[0]);
      const pick = (item: string, tag: string): string => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
      return items.map((item, i) => {
        const title = pick(item, 'title');
        const link = pick(item, 'link') || item.match(/href="([^"]+)"/)?.[1] || '';
        const summary = pick(item, 'description') || pick(item, 'summary') || pick(item, 'content');
        return `${i + 1}. ${title}\n   ${link}\n   ${summary.slice(0, 300)}`;
      }).join('\n\n');
    },
    canHandle: t => Boolean(t.url)
  };
}

function engineArxivBackend(): Backend {
  return {
    id: 'engine-arxiv',
    label: 'S-AI arXiv export',
    tier: 0,
    async probe() {
      try {
        const { findEngineRoot } = await import('../adapters/engine.js');
        const root = findEngineRoot();
        if (!root) return { ok: true, detail: 'engine resolved at runtime' };
        return { ok: existsSync(join(root, 'dist', 'src', 'tools', 'arxiv.js')), prescription: 'build the engine: npm run build (in s-ai root)' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
    async read({ query }) {
      if (!query) throw new Error('query required');
      const { loadEngine } = await import('../adapters/engine.js');
      const engine = await loadEngine();
      const result = await engine.arxiv.searchArxiv(query, 0, 10);
      return result.papers.map((p, i) => `${i + 1}. ${p.title}\n   ${p.id}\n   ${String(p.summary || '').slice(0, 300)}`).join('\n\n');
    },
    canHandle: t => Boolean(t.query)
  };
}

function crawlFetchBackend(): Backend {
  return {
    id: 'fetch-crawl',
    label: 'plain fetch crawler',
    tier: 0,
    async probe() { return { ok: true }; },
    async read({ url }) {
      if (!url) throw new Error('url required');
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 OpenWorker-Reach/2.0' }, timeoutMs: 20_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    canHandle: t => Boolean(t.url)
  };
}

function buildDefaultChannels(): Record<ChannelName, Backend[]> {
  return {
    web: [jinaReaderBackend(), directFetchBackend()],
    youtube: [ytdlpBackend()],
    github: [githubCliBackend(), githubApiBackend()],
    rss: [rssNativeBackend()],
    arxiv: [engineArxivBackend()],
    crawl: [crawlFetchBackend()]
  };
}

/** Convenience: a registry wired with all v1 channels (FR-R3). */
export function buildDefaultRegistry(options: RegistryOptions = {}): ReachRegistry {
  return new ReachRegistry(undefined, options);
}
