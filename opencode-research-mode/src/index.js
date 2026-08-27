import { tool } from "@opencode-ai/plugin";

// ── Web Fetcher (stdlib, no deps) ─────────────────────────────

const DEFAULT_UA = "Mozilla/5.0 (compatible; OpenCodeResearch/1.0)";

const cache = new Map();
const CACHE_MAX = 100;

async function fetchUrl(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const contentType = resp.headers.get("content-type") || "";

    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
      return {
        url,
        status: resp.status,
        title: "PDF Document",
        description: "PDF detected — use paper_analyze tool for extraction",
        text: `[PDF detected: ${resp.headers.get("content-length") || "?"} bytes]`,
        wordCount: 0,
        truncated: false,
      };
    }

    const html = await resp.text();
    const truncated = html.length > 10 * 1024 * 1024;

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = (titleMatch && titleMatch[1] ? titleMatch[1].trim() : "");

    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
    );
    const description = (descMatch && descMatch[1] ? descMatch[1].trim() : "");

    const text = extractText(html);

    return {
      url,
      status: resp.status,
      title,
      description,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(html) {
  const SKIP = new Set(["script", "style", "nav", "header", "footer", "aside", "noscript", "iframe"]);
  const BLOCK = new Set(["p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote", "pre", "section", "article"]);

  let result = "";
  let skipDepth = 0;
  const tagStack = [];

  const tagRegex = /<(\/?)(\w+)[^>]*>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tag = match[2].toLowerCase();

    const textBefore = html.slice(lastIndex, match.index);
    if (skipDepth === 0) {
      result += textBefore;
    }

    if (isClosing) {
      if (tagStack.length && tagStack[tagStack.length - 1] === tag) {
        tagStack.pop();
      }
      if (SKIP.has(tag)) {
        skipDepth = Math.max(0, skipDepth - 1);
      }
      if (skipDepth === 0 && BLOCK.has(tag)) {
        result += "\n";
      }
    } else {
      tagStack.push(tag);
      if (SKIP.has(tag)) {
        skipDepth++;
      }
      if (skipDepth === 0 && BLOCK.has(tag)) {
        result += "\n";
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (skipDepth === 0) {
    result += html.slice(lastIndex);
  }

  return result
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function cacheGet(url) {
  return cache.get(url);
}

function cachePut(url, result) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(url, result);
}

function formatResult(r) {
  return [
    `## ${r.title || r.url}`,
    r.description ? `> ${r.description}` : "",
    `**Status:** ${r.status} | **Words:** ${r.wordCount}${r.truncated ? " (truncated)" : ""}`,
    "",
    r.text.slice(0, 15000),
    r.text.length > 15000 ? "\n\n[... truncated for display]" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSummary(r) {
  return `${r.title || "Untitled"} (${r.wordCount} words, status ${r.status})`;
}

// ── Plugin ─────────────────────────────────────────────────────

/** @type {import("@opencode-ai/plugin").Plugin} */
export const ResearchModePlugin = async (_ctx) => {
  return {
    tool: {
      research_fetch: tool({
        description:
          "Fetch a URL and extract clean text content. Returns title, description, word count, and extracted text. Supports HTML pages, skips scripts/styles/nav. Detects PDFs.",
        args: {
          url: tool.schema.string().url().describe("URL to fetch"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout in milliseconds (default: 30000)"),
        },
        async execute(args) {
          const url = args.url;
          const timeout = args.timeout || 30000;

          const cached = cacheGet(url);
          if (cached) {
            return {
              title: `Cached: ${cached.title}`,
              output: formatResult(cached),
              metadata: { cached: true, wordCount: cached.wordCount },
            };
          }

          try {
            const result = await fetchUrl(url, timeout);
            cachePut(url, result);
            return {
              title: result.title || url,
              output: formatResult(result),
              metadata: { cached: false, wordCount: result.wordCount },
            };
          } catch (e) {
            return {
              title: `Error: ${url}`,
              output: `Failed to fetch ${url}: ${e.message}`,
              metadata: { error: true },
            };
          }
        },
      }),

      research_multi_fetch: tool({
        description:
          "Fetch multiple URLs with rate limiting. Returns results for each URL with title, word count, and text.",
        args: {
          urls: tool.schema
            .array(tool.schema.string().url())
            .describe("Array of URLs to fetch"),
          delay: tool.schema
            .number()
            .optional()
            .describe("Delay between requests in ms (default: 1000)"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Per-request timeout in ms (default: 30000)"),
        },
        async execute(args) {
          const { urls, delay = 1000, timeout = 30000 } = args;
          const results = [];

          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const cached = cacheGet(url);
            if (cached) {
              results.push(`[${i + 1}/${urls.length}] CACHED: ${url}\n${formatSummary(cached)}`);
              continue;
            }

            try {
              const result = await fetchUrl(url, timeout);
              cachePut(url, result);
              results.push(
                `[${i + 1}/${urls.length}] ${url}\n${formatSummary(result)}`,
              );
            } catch (e) {
              results.push(
                `[${i + 1}/${urls.length}] FAILED: ${url}\nError: ${e.message}`,
              );
            }

            if (delay > 0 && i < urls.length - 1) {
              await new Promise((r) => setTimeout(r, delay));
            }
          }

          return {
            title: `Fetched ${urls.length} URLs`,
            output: results.join("\n\n---\n\n"),
            metadata: { totalUrls: urls.length },
          };
        },
      }),

      research_extract: tool({
        description:
          "Extract specific information from already-fetched content. Use after research_fetch to pull out key findings, quotes, data points, or summaries.",
        args: {
          url: tool.schema
            .string()
            .url()
            .describe("URL that was previously fetched"),
          query: tool.schema
            .string()
            .describe(
              "What to extract: 'summary', 'key-findings', 'data-points', 'quotes', or a custom prompt",
            ),
          max_words: tool.schema
            .number()
            .optional()
            .describe("Maximum words to return (default: 500)"),
        },
        async execute(args) {
          const cached = cacheGet(args.url);
          if (!cached) {
            return {
              title: "Not found",
              output: `URL "${args.url}" not in cache. Run research_fetch first.`,
              metadata: { error: true },
            };
          }

          const maxWords = args.max_words || 500;
          const text = cached.text;
          const words = text.split(/\s+/);

          let extracted;
          if (words.length <= maxWords) {
            extracted = text;
          } else {
            extracted = words.slice(0, maxWords).join(" ") + `\n\n[... truncated, ${words.length} total words]`;
          }

          return {
            title: `Extract: ${args.query} from ${cached.title || args.url}`,
            output: `## Source: ${cached.title || args.url}\n## Query: ${args.query}\n\n${extracted}`,
            metadata: { wordCount: Math.min(words.length, maxWords) },
          };
        },
      }),

      research_cache_status: tool({
        description:
          "Show the current research cache status — how many URLs are cached and their titles.",
        args: {},
        async execute() {
          const entries = Array.from(cache.entries()).map(
            ([url, r]) => `- ${r.title || url} (${r.wordCount} words)`,
          );

          return {
            title: `Cache: ${cache.size}/${CACHE_MAX}`,
            output:
              entries.length > 0
                ? `## Cached URLs (${cache.size}/${CACHE_MAX})\n\n${entries.join("\n")}`
                : "Cache is empty.",
            metadata: { size: cache.size, max: CACHE_MAX },
          };
        },
      }),

      research_cache_clear: tool({
        description: "Clear the research URL cache.",
        args: {},
        async execute() {
          const size = cache.size;
          cache.clear();
          return {
            title: "Cache cleared",
            output: `Cleared ${size} cached URLs.`,
            metadata: { cleared: size },
          };
        },
      }),
    },
  };
};

export default ResearchModePlugin;
