import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCrawlConfig, getCacheDir, hashContent } from '../config.js';
import { safeFetch, isPrivateUrl } from '../security/ssrf.js';
const MAX_CRAWL_RESPONSE_BYTES = 5 * 1024 * 1024;
class CrawlEngine {
    config;
    cacheDir;
    constructor(config = {}) {
        this.config = { ...getCrawlConfig(), ...config };
        this.cacheDir = join(getCacheDir(), 'crawl');
        if (!existsSync(this.cacheDir))
            mkdirSync(this.cacheDir, { recursive: true });
    }
    async crawl(urls, options = {}) {
        if (typeof urls === 'string')
            urls = [urls];
        const urlArr = urls;
        const results = [];
        for (const url of urlArr.slice(0, this.config.maxPages || 5)) {
            if (isPrivateUrl(url)) {
                results.push({ url, error: 'Blocked: private/internal URL', content: '' });
                continue;
            }
            try {
                const cached = this._getCache(url);
                if (cached) {
                    results.push(cached);
                    continue;
                }
                const result = await this._fetchAndExtract(url, options);
                this._setCache(url, result);
                results.push(result);
                if (this.config.delayBetweenRequests) {
                    await new Promise(r => setTimeout(r, this.config.delayBetweenRequests));
                }
            }
            catch (err) {
                results.push({ url, error: err.message, content: '' });
            }
        }
        return results;
    }
    async _fetchAndExtract(url, options = {}) {
        try {
            const resp = await safeFetch(url, {
                timeout: options.timeout || 30_000,
                maxResponseBytes: MAX_CRAWL_RESPONSE_BYTES,
                maxRedirects: 5,
            });
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();
            const content = this._extractContent(html, url);
            return { url, content, title: this._extractTitle(html), extractedAt: new Date().toISOString(), length: content.length };
        }
        catch (err) {
            throw err;
        }
    }
    _extractContent(html, url) {
        let text = html;
        const removePatterns = [
            /<script[\s\S]*?<\/script>/gi,
            /<style[\s\S]*?<\/style>/gi,
            /<nav[\s\S]*?<\/nav>/gi,
            /<footer[\s\S]*?<\/footer>/gi,
            /<header[\s\S]*?<\/header>/gi,
            /<aside[\s\S]*?<\/aside>/gi
        ];
        for (const pattern of removePatterns)
            text = text.replace(pattern, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        text = text.replace(/\s+/g, ' ').trim();
        const maxTokens = this.config.contentMaxTokens || 8000;
        const maxChars = maxTokens * 4;
        if (text.length > maxChars)
            text = text.slice(0, maxChars) + '\n[...truncated]';
        return text;
    }
    _extractTitle(html) {
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return match ? match[1].trim() : 'Untitled';
    }
    _getCache(url) {
        if (!this.config.cacheEnabled)
            return null;
        const key = hashContent(url);
        const cacheFile = join(this.cacheDir, `${key}.json`);
        if (!existsSync(cacheFile))
            return null;
        try {
            const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
            if (Date.now() - new Date(cached.extractedAt).getTime() > (this.config.cacheTTL || 3600000))
                return null;
            return cached;
        }
        catch {
            return null;
        }
    }
    _setCache(url, result) {
        if (!this.config.cacheEnabled)
            return;
        const key = hashContent(url);
        writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(result, null, 2));
    }
    async search(query, options = {}) {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        try {
            const results = await this.crawl([searchUrl], options);
            const links = this._parseSearchResults(results[0]?.content || '');
            const pageResults = [];
            for (const link of links.slice(0, options.maxResults || 3)) {
                if (isPrivateUrl(link.url))
                    continue;
                const pageResult = await this.crawl([link.url], options);
                if (pageResult[0]?.content) {
                    pageResults.push({ title: link.title, url: link.url, snippet: link.snippet, content: pageResult[0].content });
                }
            }
            return pageResults;
        }
        catch (err) {
            return [{ title: '', url: '', snippet: '', error: err.message }];
        }
    }
    _parseSearchResults(html) {
        const results = [];
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
let _engine = null;
function getCrawlEngine(config) {
    if (!_engine)
        _engine = new CrawlEngine(config);
    return _engine;
}
export { CrawlEngine, getCrawlEngine };
//# sourceMappingURL=crawl.js.map