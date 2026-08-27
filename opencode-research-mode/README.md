# @opencode-ai/research-mode

Deep research plugin for [opencode](https://opencode.ai) — web fetching, agent-based research loops, and paper analysis.

## Tools

| Tool | Description |
|------|-------------|
| `research_fetch` | Fetch a URL and extract clean text content |
| `research_multi_fetch` | Fetch multiple URLs with rate limiting |
| `research_extract` | Extract specific info from cached content |
| `research_cache_status` | Show cached URLs |
| `research_cache_clear` | Clear the cache |

## Install

```bash
# In your opencode config (~/.config/opencode/opencode.jsonc):
{
  "plugin": [
    ["/path/to/opencode-research-mode", {}]
  ]
}
```

## Usage

Once installed, the tools are available in any opencode session:

```
> Research the latest advances in document OCR
> Fetch https://example.com/article and summarize it
> Compare these 3 sources on quantum computing
```

## Features

- Zero external dependencies (uses Node.js stdlib `fetch`)
- Built-in LRU cache (100 URLs max)
- HTML → clean text extraction (skips scripts, styles, nav)
- PDF detection
- Rate limiting for batch fetches
- Configurable timeouts

## License

MIT
