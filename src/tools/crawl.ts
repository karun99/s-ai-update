import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCrawlConfig, getCacheDir, hashContent } from '../config.js';
import type { CrawlConfig } from '../config.js';
import { safeFetch, isPrivateUrl } from '../security/ssrf.js';

interface CrawlResult {
  url: string;
  content: string;
  title?: string;
  extractedAt?: string;
  length?: number;
  error?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  error?: string;
}

interface ParsedLink {
  url: string;
  title: string;
  snippet: string;
}

const MAX_CRAWL_RESPONSE_BYTES = 5 * 1024 * 1024;

class CrawlEngine {
  config: CrawlConfig;
  cacheDir: string;

  constructor(config: CrawlConfig = {}) {
    this.config = { ...getCrawlConfig(), ...config };
    this.cacheDir = join(getCacheDir(), 'crawl');
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true });
  }

  async crawl(urls: string | string[], options: { timeout?: number } = {}): Promise<CrawlResult[]> {
    if (typeof urls === 'string') urls = [urls];
    const urlArr = urls as string[];
    const results: CrawlResult[] = [];
    for (const url of urlArr.slice(0, (this.config.maxPages as number) || 5)) {
      if (isPrivateUrl(url)) {
        results.push({ url, error: 'Blocked: private/internal URL', content: '' });
        continue;
      }
      try {
        const cached = this._getCache(url);
        if (cached) { results.push(cached); continue; }
        const result = await this._fetchAndExtract(url, options);
        this._setCache(url, result);
        results.push(result);
        if (this.config.delayBetweenRequests) {
          await new Promise(r => setTimeout(r, this.config.delayBetweenRequests as number));
        }
      } catch (err: any) {
        results.push({ url, error: err.message, content: '' });
      }
    }
    return results;
  }

  async _fetchAndExtract(url: string, options: { timeout?: number } = {}): Promise<CrawlResult> {
    try {
      const resp = await safeFetch(url, {
        timeout: options.timeout || 30_000,
        maxResponseBytes: MAX_CRAWL_RESPONSE_BYTES,
        maxRedirects: 5,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const content = this._extractContent(html, url);
      return { url, content, title: this._extractTitle(html), extractedAt: new Date().toISOString(), length: content.length };
    } catch (err: any) {
      throw err;
    }
  }

  _extractContent(html: string, url: string): string {
    let text = html;
    const removePatterns = [
      /<script[\s\S]*?<\/script>/gi,
      /<style[\s\S]*?<\/style>/gi,
      /<nav[\s\S]*?<\/nav>/gi,
      /<footer[\s\S]*?<\/footer>/gi,
      /<header[\s\S]*?<\/header>/gi,
      /<aside[\s\S]*?<\/aside>/gi
    ];
    for (const pattern of removePatterns) text = text.replace(pattern, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    const maxTokens = (this.config.contentMaxTokens as number) || 8000;
    const maxChars = maxTokens * 4;
    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n[...truncated]';
    return text;
  }

  _extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : 'Untitled';
  }

  _getCache(url: string): CrawlResult | null {
    if (!this.config.cacheEnabled) return null;
    const key = hashContent(url);
    const cacheFile = join(this.cacheDir, `${key}.json`);
    if (!existsSync(cacheFile)) return null;
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (Date.now() - new Date(cached.extractedAt).getTime() > ((this.config.cacheTTL as number) || 3600000)) return null;
      return cached;
    } catch { return null; }
  }

  _setCache(url: string, result: CrawlResult): void {
    if (!this.config.cacheEnabled) return;
    const key = hashContent(url);
    writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(result, null, 2));
  }

  async search(query: string, options: { maxResults?: number; timeout?: number } = {}): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
      const results = await this.crawl([searchUrl], options);
      const links = this._parseSearchResults(results[0]?.content || '');
      const pageResults: SearchResult[] = [];
      for (const link of links.slice(0, options.maxResults || 3)) {
        if (isPrivateUrl(link.url)) continue;
        const pageResult = await this.crawl([link.url], options);
        if (pageResult[0]?.content) {
          pageResults.push({ title: link.title, url: link.url, snippet: link.snippet, content: pageResult[0].content });
        }
      }
      return pageResults;
    } catch (err: any) {
      return [{ title: '', url: '', snippet: '', error: err.message }];
    }
  }

  _parseSearchResults(html: string): ParsedLink[] {
    const results: ParsedLink[] = [];
    const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      results.push({ url: match[1], title: match[2], snippet: '' });
    }
    let idx = 0;
    while ((match = snippetPattern.exec(html)) !== null && idx < results.length) {
      results[idx].snippet = match[1].replace(/<[^>]+>/g, '').trim();
      idx++;
    }
    return results;
  }
}

let _engine: CrawlEngine | null = null;
function getCrawlEngine(config?: CrawlConfig): CrawlEngine {
  if (!_engine) _engine = new CrawlEngine(config);
  return _engine;
}

export { CrawlEngine, getCrawlEngine };
export type { CrawlResult, SearchResult, ParsedLink };
